import { join } from "node:path";

import { envPath, readSecret, stateDirOf, type UpstreamEndpoint } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

/**
 * Settings, from the environment only (README, Configuration). Nothing here
 * reads a file or refuses to start: a password, a token or a vault that is
 * missing is the failure of the call that needs it, so the server always
 * starts and lists its tools.
 *
 * ETOLL_STATE_DIR is where the session, a begun login, quotes and orders
 * live; unset, the kit's one default for state (packages/mcp-kit, env.ts).
 * The rest name eToll and its Keycloak, and default to the public ones, so
 * another deployment (a test realm, a mirror) is a variable away:
 *
 * - ETOLL_ISSUER: the realm, `https://sso.etoll.ro/auth/realms/external`
 * - ETOLL_CLIENT_ID: the portal's own public client, `ddcm-authz-client`
 * - ETOLL_API: `https://portal.etoll.ro`, the API under `/api` and CNAIR's
 *   status page under `/status`
 * - ETOLL_REDIRECT_URI: where Keycloak sends the browser back after a browser
 *   sign-in: by default a static file of the portal's that does nothing when
 *   opened as a page, so the code stays in the address bar unspent
 * - ETOLL_SCOPES: space-separated, `openid profile offline_access`
 * - ETOLL_LOGIN_SCRIPT: a command this deployment has that runs a browser
 *   sign-in end to end, named in the remedy when set
 * - ETOLL_OUTBOX_DIR: where downloaded invoices go, `<state>/outbox`
 */

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

const noSlash = (url: string): string => url.replace(/\/+$/, "");

/** A JSON value from a variable: absent, parsed, or the reason it is not JSON. */
export type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

const json = (name: string, raw: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `${name} is not JSON: ${raw.slice(0, 80)}` };
  }
};

type Command = { readonly command: string; readonly args: readonly string[] };

/** A stdio command: a JSON array of strings (`["npx","-y","some-vault-mcp"]`), or words separated by spaces. Undefined for anything else. */
const commandOf = (raw: string): Command | undefined => {
  const parsed = raw.startsWith("[") ? json("command", raw) : { ok: true as const, value: raw.split(/\s+/) };
  const argv = parsed.ok ? parsed.value : undefined;
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a): a is string => typeof a === "string" && a.length > 0)) return undefined;
  const [command = "", ...args] = argv;
  return { command, args };
};

/**
 * The environment a spawned vault server gets: this process's, without this
 * server's own settings and without the transport settings meant for this
 * server (an inherited MCP_HTTP_PORT would make the child listen instead of
 * speaking stdio).
 */
export const childEnv = (env: NodeJS.ProcessEnv): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("ETOLL_") && !e[0].startsWith("MCP_") && e[0] !== "CREDENTIALS_DIRECTORY"),
  );

export type UpstreamSetting =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "endpoint"; readonly endpoint: UpstreamEndpoint; readonly transport: "http" | "stdio"; readonly label: string };

const vaultUpstream = (env: NodeJS.ProcessEnv): UpstreamSetting => {
  const url = trimmed(env["ETOLL_VAULT_MCP_URL"]);
  const command = trimmed(env["ETOLL_VAULT_MCP_COMMAND"]);
  if (url !== undefined) {
    const u = URL.parse(url);
    if (u === null) return { kind: "invalid", message: "ETOLL_VAULT_MCP_URL is not a URL" };
    const token = () => readSecret(env, { file: "ETOLL_VAULT_MCP_TOKEN_FILE", value: "ETOLL_VAULT_MCP_TOKEN" }, (message) => fail(configError(message)));
    return { kind: "endpoint", transport: "http", label: `${u.protocol}//${u.host}${u.pathname}`, endpoint: { kind: "http", url, token } };
  }
  if (command !== undefined) {
    const parsed = commandOf(command);
    if (parsed === undefined) return { kind: "invalid", message: "ETOLL_VAULT_MCP_COMMAND must be a command: a JSON array of strings, or words separated by spaces" };
    return { kind: "endpoint", transport: "stdio", label: parsed.command, endpoint: { kind: "stdio", command: parsed.command, args: parsed.args, env: childEnv(env) } };
  }
  return { kind: "none" };
};

export type VaultSettings = {
  readonly upstream: UpstreamSetting;
  readonly item: string | undefined;
  readonly tool: string;
  readonly args: Parsed;
  readonly passwordField: string;
  readonly usernameField: string;
};

export type AppConfig = {
  readonly stateDir: string;
  readonly outboxDir: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly api: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly loginScript: string | undefined;
  readonly username: string | undefined;
  /** Reads the password from ETOLL_PASSWORD_FILE, else ETOLL_PASSWORD; called only at a sign-in. */
  readonly password: (() => Promise<string>) | undefined;
  readonly passwordFrom: "file" | "variable" | undefined;
  readonly vault: VaultSettings;
};

export const configFrom = (env: NodeJS.ProcessEnv): AppConfig => {
  const stateDir = stateDirOf(env, "etoll", "ETOLL_STATE_DIR");
  const vaultArgs = trimmed(env["ETOLL_VAULT_ARGS"]);
  const api = noSlash(trimmed(env["ETOLL_API"]) ?? "https://portal.etoll.ro");
  const passwordFrom = trimmed(env["ETOLL_PASSWORD_FILE"]) !== undefined ? "file" : trimmed(env["ETOLL_PASSWORD"]) !== undefined ? "variable" : undefined;
  return {
    stateDir,
    outboxDir: envPath(env, "ETOLL_OUTBOX_DIR") ?? join(stateDir, "outbox"),
    issuer: noSlash(trimmed(env["ETOLL_ISSUER"]) ?? "https://sso.etoll.ro/auth/realms/external"),
    clientId: trimmed(env["ETOLL_CLIENT_ID"]) ?? "ddcm-authz-client",
    api,
    redirectUri: trimmed(env["ETOLL_REDIRECT_URI"]) ?? `${api}/portal-extern/apm-env.js`,
    scopes: (trimmed(env["ETOLL_SCOPES"]) ?? "openid profile offline_access").split(/\s+/).filter((s) => s !== ""),
    loginScript: trimmed(env["ETOLL_LOGIN_SCRIPT"]),
    username: trimmed(env["ETOLL_USERNAME"]),
    password:
      passwordFrom === undefined
        ? undefined
        : async () =>
            (await readSecret(env, { file: "ETOLL_PASSWORD_FILE", value: "ETOLL_PASSWORD" }, (message) => fail(configError(message)))) ??
            fail(configError("the eToll password is empty")),
    passwordFrom,
    vault: {
      upstream: vaultUpstream(env),
      item: trimmed(env["ETOLL_VAULT_ITEM"]),
      tool: trimmed(env["ETOLL_VAULT_TOOL"]) ?? "get_password",
      args: vaultArgs === undefined ? { ok: true, value: { id: "{{item}}" } } : json("ETOLL_VAULT_ARGS", vaultArgs),
      passwordField: trimmed(env["ETOLL_VAULT_PASSWORD_FIELD"]) ?? "password",
      usernameField: trimmed(env["ETOLL_VAULT_USERNAME_FIELD"]) ?? "username",
    },
  };
};

/** Keycloak's endpoints under a realm (OpenID Connect discovery names them; these are its fixed paths). */
export const endpoints = (issuer: string) => ({
  authorize: `${issuer}/protocol/openid-connect/auth`,
  token: `${issuer}/protocol/openid-connect/token`,
  logout: `${issuer}/protocol/openid-connect/logout`,
});
