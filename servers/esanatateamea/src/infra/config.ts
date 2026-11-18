import { join } from "node:path";

import { envPath, readSecret, stateDirOf, type UpstreamEndpoint } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

/**
 * Settings, from the environment only (README, Configuration). Nothing here
 * reads a file or refuses to start: a password, a key or a vault that is
 * missing is the failure of the call that needs it, so the server always
 * starts and lists its tools.
 *
 * ESANATATEAMEA_STATE_DIR is where the session and a begun login live;
 * unset, the kit's one default for state (packages/mcp-kit, env.ts). The rest
 * name the portal and its Keycloak, and default to the public ones:
 *
 * - ESANATATEAMEA_ISSUER: the realm, `https://sso.esanatateamea.ro/realms/eSM`
 * - ESANATATEAMEA_CLIENT_ID: the portal's own public client, `eSm`
 * - ESANATATEAMEA_PORTAL: `https://portal.esanatateamea.ro`, its APIs under `/api`
 * - ESANATATEAMEA_REDIRECT_URI: where Keycloak sends the browser back: by
 *   default the portal's `env.js`, a static file the client accepts as a
 *   redirect, which does nothing when opened, so a ROeID code stays in the
 *   address bar unspent
 * - ESANATATEAMEA_SCOPES: `openid offline_access`: an offline session, which
 *   does not end with the browser's
 * - ESANATATEAMEA_LOGIN_SCRIPT: a command this deployment has that runs the
 *   ROeID leg end to end, named in the remedy when set
 * - ESANATATEAMEA_KEEPALIVE_MIN: refresh every N minutes while a session
 *   exists, so an offline session is never idle long enough to lapse
 * - ESANATATEAMEA_OUTBOX_DIR: where downloaded documents go, `<state>/outbox`
 */

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

const noSlash = (url: string): string => url.replace(/\/+$/, "");

/** A JSON value from a variable: absent, parsed, or the reason it is not JSON. The reason never repeats the value, which can hold a secret. */
export type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

const json = (name: string, raw: string): Parsed => {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `${name} is not JSON (its value is not repeated here, since it can hold a secret)` };
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
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("ESANATATEAMEA_") && !e[0].startsWith("MCP_") && e[0] !== "CREDENTIALS_DIRECTORY"),
  );

export type UpstreamSetting =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "endpoint"; readonly endpoint: UpstreamEndpoint; readonly transport: "http" | "stdio"; readonly label: string };

const vaultUpstream = (env: NodeJS.ProcessEnv): UpstreamSetting => {
  const url = trimmed(env["ESANATATEAMEA_VAULT_MCP_URL"]);
  const command = trimmed(env["ESANATATEAMEA_VAULT_MCP_COMMAND"]);
  if (url !== undefined) {
    const u = URL.parse(url);
    if (u === null) return { kind: "invalid", message: "ESANATATEAMEA_VAULT_MCP_URL is not a URL" };
    const token = () => readSecret(env, { file: "ESANATATEAMEA_VAULT_MCP_TOKEN_FILE", value: "ESANATATEAMEA_VAULT_MCP_TOKEN" }, (message) => fail(configError(message)));
    return { kind: "endpoint", transport: "http", label: `${u.protocol}//${u.host}${u.pathname}`, endpoint: { kind: "http", url, token } };
  }
  if (command !== undefined) {
    const parsed = commandOf(command);
    if (parsed === undefined) return { kind: "invalid", message: "ESANATATEAMEA_VAULT_MCP_COMMAND must be a command: a JSON array of strings, or words separated by spaces" };
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
  /** The tool that answers the item's current authenticator code; undefined when turned off ("none"). */
  readonly codeTool: string | undefined;
  readonly codeField: string;
};

export type AppConfig = {
  readonly stateDir: string;
  readonly outboxDir: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly portal: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly loginScript: string | undefined;
  readonly keepaliveMin: number;
  readonly username: string | undefined;
  /** Reads the password from ESANATATEAMEA_PASSWORD_FILE, else ESANATATEAMEA_PASSWORD; called only at a sign-in. */
  readonly password: (() => Promise<string>) | undefined;
  readonly passwordFrom: "file" | "variable" | undefined;
  /** Reads the authenticator secret from ESANATATEAMEA_TOTP_SECRET_FILE, else ESANATATEAMEA_TOTP_SECRET; called only at a sign-in. */
  readonly totpSecret: (() => Promise<string>) | undefined;
  readonly totpFrom: "file" | "variable" | undefined;
  readonly vault: VaultSettings;
};

const fromFileOrVariable = (env: NodeJS.ProcessEnv, file: string, variable: string): "file" | "variable" | undefined =>
  trimmed(env[file]) !== undefined ? "file" : trimmed(env[variable]) !== undefined ? "variable" : undefined;

const secretReader = (env: NodeJS.ProcessEnv, file: string, value: string, what: string) => async (): Promise<string> =>
  (await readSecret(env, { file, value }, (message) => fail(configError(message)))) ?? fail(configError(`${what} is empty`));

export const configFrom = (env: NodeJS.ProcessEnv): AppConfig => {
  const stateDir = stateDirOf(env, "esanatateamea", "ESANATATEAMEA_STATE_DIR");
  const portal = noSlash(trimmed(env["ESANATATEAMEA_PORTAL"]) ?? "https://portal.esanatateamea.ro");
  const vaultArgs = trimmed(env["ESANATATEAMEA_VAULT_ARGS"]);
  const codeTool = trimmed(env["ESANATATEAMEA_VAULT_CODE_TOOL"]) ?? "totp";
  const keepalive = Number(trimmed(env["ESANATATEAMEA_KEEPALIVE_MIN"]) ?? "0");
  const passwordFrom = fromFileOrVariable(env, "ESANATATEAMEA_PASSWORD_FILE", "ESANATATEAMEA_PASSWORD");
  const totpFrom = fromFileOrVariable(env, "ESANATATEAMEA_TOTP_SECRET_FILE", "ESANATATEAMEA_TOTP_SECRET");
  return {
    stateDir,
    outboxDir: envPath(env, "ESANATATEAMEA_OUTBOX_DIR") ?? join(stateDir, "outbox"),
    issuer: noSlash(trimmed(env["ESANATATEAMEA_ISSUER"]) ?? "https://sso.esanatateamea.ro/realms/eSM"),
    clientId: trimmed(env["ESANATATEAMEA_CLIENT_ID"]) ?? "eSm",
    portal,
    redirectUri: trimmed(env["ESANATATEAMEA_REDIRECT_URI"]) ?? `${portal}/env.js`,
    scopes: (trimmed(env["ESANATATEAMEA_SCOPES"]) ?? "openid offline_access").split(/\s+/).filter((s) => s !== ""),
    loginScript: trimmed(env["ESANATATEAMEA_LOGIN_SCRIPT"]),
    keepaliveMin: Number.isFinite(keepalive) && keepalive > 0 ? keepalive : 0,
    username: trimmed(env["ESANATATEAMEA_USERNAME"]),
    password: passwordFrom === undefined ? undefined : secretReader(env, "ESANATATEAMEA_PASSWORD_FILE", "ESANATATEAMEA_PASSWORD", "the eSănătateaMea password"),
    passwordFrom,
    totpSecret: totpFrom === undefined ? undefined : secretReader(env, "ESANATATEAMEA_TOTP_SECRET_FILE", "ESANATATEAMEA_TOTP_SECRET", "the authenticator secret"),
    totpFrom,
    vault: {
      upstream: vaultUpstream(env),
      item: trimmed(env["ESANATATEAMEA_VAULT_ITEM"]),
      tool: trimmed(env["ESANATATEAMEA_VAULT_TOOL"]) ?? "get_password",
      args: vaultArgs === undefined ? { ok: true, value: { id: "{{item}}" } } : json("ESANATATEAMEA_VAULT_ARGS", vaultArgs),
      passwordField: trimmed(env["ESANATATEAMEA_VAULT_PASSWORD_FIELD"]) ?? "password",
      usernameField: trimmed(env["ESANATATEAMEA_VAULT_USERNAME_FIELD"]) ?? "username",
      codeTool: codeTool.toLowerCase() === "none" ? undefined : codeTool,
      codeField: trimmed(env["ESANATATEAMEA_VAULT_CODE_FIELD"]) ?? "code",
    },
  };
};

/** Keycloak's endpoints under a realm (OpenID Connect discovery names them; these are its fixed paths). */
export const endpoints = (issuer: string) => ({
  authorize: `${issuer}/protocol/openid-connect/auth`,
  token: `${issuer}/protocol/openid-connect/token`,
  logout: `${issuer}/protocol/openid-connect/logout`,
});
