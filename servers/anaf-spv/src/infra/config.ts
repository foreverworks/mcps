import { join } from "node:path";

import { envPath, readSecret, stateDirOf } from "@foreverworks/mcp-kit";

import { CODE_SENDER, CODE_SUBJECT } from "../domain/codes.js";
import { configError, fail } from "../domain/errors.js";
import type { MailDriver } from "./mail/source.js";
import type { Endpoint } from "./upstream/mcp.js";

/**
 * Settings, from the environment only (README, Configuration). Nothing here
 * reads a file or refuses to start: a credential, a token or an upstream that
 * is missing is the failure of the tool that needs it, so the server always
 * starts and lists its tools. A value that cannot be parsed (a JSON template,
 * a command) is reported the same way, by the tools that would use it.
 */

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

/** A JSON value from a variable: absent, parsed, or the reason it is not JSON. */
type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

const json = (name: string, raw: string | undefined): Parsed | undefined => {
  if (raw === undefined) return undefined;
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `${name} is not JSON: ${raw.slice(0, 80)}` };
  }
};

/** A stdio command: a JSON array of strings (`["npx","-y","some-mail-mcp"]`), or words separated by spaces. */
const commandOf = (name: string, raw: string): { readonly command: string; readonly args: readonly string[] } => {
  const argv: unknown = raw.startsWith("[") ? (json(name, raw) as { value?: unknown } | undefined)?.value : raw.split(/\s+/);
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a): a is string => typeof a === "string" && a.length > 0)) {
    return fail(configError(`${name} must be a command: a JSON array of strings, or words separated by spaces`));
  }
  const [command = "", ...args] = argv;
  return { command, args };
};

/**
 * The environment a spawned upstream server gets: this process's, without
 * this server's own settings (its password among them) and without the
 * transport settings meant for this server (an inherited MCP_HTTP_PORT would
 * make the child listen instead of speaking stdio).
 */
export const childEnv = (env: NodeJS.ProcessEnv): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("ANAF_SPV_") && !e[0].startsWith("MCP_") && e[0] !== "CREDENTIALS_DIRECTORY"),
  );

export type UpstreamSetting =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "endpoint"; readonly endpoint: Endpoint; readonly transport: "http" | "stdio"; readonly label: string };

const upstream = (env: NodeJS.ProcessEnv, names: { readonly url: string; readonly tokenFile: string; readonly token: string; readonly command: string }, url: string | undefined, command: string | undefined): UpstreamSetting => {
  if (url !== undefined) {
    const label = (() => {
      try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return undefined;
      }
    })();
    if (label === undefined) return { kind: "invalid", message: `${names.url} is not a URL` };
    const token = () => readSecret(env, { file: names.tokenFile, value: names.token }, (message) => fail(configError(message)));
    return { kind: "endpoint", transport: "http", label, endpoint: { kind: "http", url, token } };
  }
  if (command !== undefined) {
    try {
      const { command: cmd, args } = commandOf(names.command, command);
      return { kind: "endpoint", transport: "stdio", label: cmd, endpoint: { kind: "stdio", command: cmd, args, env: childEnv(env) } };
    } catch {
      return { kind: "invalid", message: `${names.command} must be a command: a JSON array of strings, or words separated by spaces` };
    }
  }
  return { kind: "none" };
};

export type AppConfig = {
  readonly stateDir: string;
  readonly downloadsDir: string;
  readonly portal: string;
  /** formularespv-pf: where a person files declarations, a separate sign-in from the portal's. */
  readonly formsPortal: string;
  /** ANAF's public status service for filings (StareD112). */
  readonly statusService: string;
  /** The Java runtime DUKIntegrator runs on. */
  readonly java: string;
  /** Where DUKIntegrator kits are built and kept, one per form and reporting year. */
  readonly dukDir: string;
  readonly codeWaitMs: number;
  readonly keepaliveMin: number;
  readonly vault: {
    readonly upstream: UpstreamSetting;
    readonly item: string | undefined;
    readonly tool: string;
    readonly args: Parsed;
    readonly passwordField: string;
    readonly usernameField: string;
    readonly username: string | undefined;
    readonly passwordFile: string | undefined;
    readonly passwordVariable: boolean;
  };
  readonly mail: {
    readonly driver: MailDriver | undefined;
    readonly driverProblem: string | undefined;
    readonly upstream: UpstreamSetting;
    readonly account: string | undefined;
    readonly query: string;
    readonly tool: string | undefined;
    readonly args: Parsed | undefined;
  };
};

const DRIVERS: readonly MailDriver[] = ["auto", "google", "text", "manual"];

/** Gmail's query syntax, which most mail MCP servers take (they are Gmail's API underneath). */
export const DEFAULT_QUERY = `from:${CODE_SENDER} subject:"${CODE_SUBJECT}" newer_than:1d`;

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw ?? "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const configFrom = (env: NodeJS.ProcessEnv): AppConfig => {
  const stateDir = stateDirOf(env, "anaf-spv", "ANAF_SPV_STATE_DIR");
  const driverRaw = trimmed(env["ANAF_SPV_MAIL_DRIVER"])?.toLowerCase();
  const driver = DRIVERS.find((d) => d === driverRaw);
  return {
    stateDir,
    downloadsDir: envPath(env, "ANAF_SPV_DOWNLOADS_DIR") ?? join(stateDir, "downloads"),
    portal: (trimmed(env["ANAF_SPV_PORTAL"]) ?? "https://pfinternet.anaf.ro").replace(/\/+$/, ""),
    formsPortal: (trimmed(env["ANAF_SPV_FORMS_PORTAL"]) ?? "https://formularespv-pf.anaf.ro").replace(/\/+$/, ""),
    statusService: (trimmed(env["ANAF_SPV_STATUS_SERVICE"]) ?? "https://stare.anaf.ro/StareD112").replace(/\/+$/, ""),
    java: trimmed(env["ANAF_SPV_JAVA"]) ?? "java",
    dukDir: envPath(env, "ANAF_SPV_DUK_DIR") ?? join(stateDir, "duk"),
    codeWaitMs: Math.min(positive(env["ANAF_SPV_CODE_WAIT_SEC"], 90), 280) * 1000,
    keepaliveMin: Number.isFinite(Number(env["ANAF_SPV_KEEPALIVE_MIN"] ?? "0")) ? Math.max(0, Number(env["ANAF_SPV_KEEPALIVE_MIN"] ?? "0")) : 0,
    vault: {
      upstream: upstream(
        env,
        { url: "ANAF_SPV_VAULT_MCP_URL", tokenFile: "ANAF_SPV_VAULT_MCP_TOKEN_FILE", token: "ANAF_SPV_VAULT_MCP_TOKEN", command: "ANAF_SPV_VAULT_MCP_COMMAND" },
        trimmed(env["ANAF_SPV_VAULT_MCP_URL"]),
        trimmed(env["ANAF_SPV_VAULT_MCP_COMMAND"]),
      ),
      item: trimmed(env["ANAF_SPV_VAULT_ITEM"]),
      tool: trimmed(env["ANAF_SPV_VAULT_TOOL"]) ?? "get_password",
      args: json("ANAF_SPV_VAULT_ARGS", trimmed(env["ANAF_SPV_VAULT_ARGS"])) ?? { ok: true, value: { id: "{{item}}" } },
      passwordField: trimmed(env["ANAF_SPV_VAULT_PASSWORD_FIELD"]) ?? "password",
      usernameField: trimmed(env["ANAF_SPV_VAULT_USERNAME_FIELD"]) ?? "username",
      username: trimmed(env["ANAF_SPV_USERNAME"]),
      passwordFile: trimmed(env["ANAF_SPV_PASSWORD_FILE"]),
      passwordVariable: trimmed(env["ANAF_SPV_PASSWORD"]) !== undefined,
    },
    mail: {
      driver,
      driverProblem: driverRaw !== undefined && driver === undefined ? `ANAF_SPV_MAIL_DRIVER "${driverRaw}" is not one of ${DRIVERS.join(", ")}` : undefined,
      upstream: upstream(
        env,
        { url: "ANAF_SPV_MAIL_MCP_URL", tokenFile: "ANAF_SPV_MAIL_MCP_TOKEN_FILE", token: "ANAF_SPV_MAIL_MCP_TOKEN", command: "ANAF_SPV_MAIL_MCP_COMMAND" },
        trimmed(env["ANAF_SPV_MAIL_MCP_URL"]),
        trimmed(env["ANAF_SPV_MAIL_MCP_COMMAND"]),
      ),
      account: trimmed(env["ANAF_SPV_MAIL_ACCOUNT"]),
      query: trimmed(env["ANAF_SPV_MAIL_QUERY"]) ?? DEFAULT_QUERY,
      tool: trimmed(env["ANAF_SPV_MAIL_SEARCH_TOOL"]),
      args: json("ANAF_SPV_MAIL_SEARCH_ARGS", trimmed(env["ANAF_SPV_MAIL_SEARCH_ARGS"])),
    },
  };
};
