import { isAbsolute, resolve } from "node:path";

import { type AllowedHost, type ClientTokenFiles, DEFAULT_FILES_MAX_BYTES, FILES_VARIABLES, type Limits, limitsFrom, listenFrom } from "@foreverworks/mcp-kit";

/**
 * What a relay is told, all of it from the environment.
 *
 * The listening half is the kit's own (MCP_HTTP_PORT, MCP_HTTP_HOST,
 * MCP_HTTP_ALLOWED_HOSTS, MCP_HTTP_TOKENS_DIR or MCP_HTTP_TOKEN_FILE), read by
 * the same function a server reads it with, so a client cannot tell the relay
 * from the server by how it is reached. The rest is the upstream (the server
 * this relay stands in for) and the two folders whose files travel.
 */
export type RelaySettings = {
  readonly port: number;
  readonly host?: string;
  readonly allowedHosts?: readonly AllowedHost[];
  readonly tokens: ClientTokenFiles;
  /** The upstream's base URL: its scheme, host and port, and the path it lives under, if any. Never ends in a slash. */
  readonly upstream: string;
  readonly upstreamTokenFile: string;
  /** Where the clients put files the server's tools read by path. Absent: no file goes up. */
  readonly inbox?: string;
  /** Where files the server's tools hand back are put for the clients. Absent: no file comes down. */
  readonly outbox?: string;
  readonly maxFileBytes: number;
  /** The kit's limits on a client: request size, time and rate (MCP_HTTP_MAX_BODY, MCP_HTTP_TIMEOUT_MS, MCP_HTTP_RATE). */
  readonly limits: Limits;
};

const folderFrom = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!isAbsolute(value)) {
    throw new Error(`${name} "${value}" is not an absolute path: the server must be able to use the same path for its own folder, so write it in full`);
  }
  return resolve(value);
};

/** MCP_RELAY_UPSTREAM: the server's base URL, as its operator gives it out; the relay adds `/mcp` and `/files/...`. */
const upstreamFrom = (raw: string | undefined): string => {
  const value = raw?.trim();
  if (!value) throw new Error("MCP_RELAY_UPSTREAM is not set: write the base URL of the server this relay stands in for, for example https://mcp.example.com");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MCP_RELAY_UPSTREAM "${value}" is not a URL: write it in full, for example https://mcp.example.com`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`MCP_RELAY_UPSTREAM "${value}" is not an http or https URL`);
  if (url.username !== "" || url.password !== "") throw new Error("MCP_RELAY_UPSTREAM carries a user name or password: the token goes in a file, named by MCP_RELAY_UPSTREAM_TOKEN_FILE");
  if (url.search !== "" || url.hash !== "") throw new Error("MCP_RELAY_UPSTREAM has a query or a fragment: write the base URL alone");
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/mcp")) throw new Error(`MCP_RELAY_UPSTREAM "${value}" ends in /mcp: write the server's base URL, without it`);
  return `${url.origin}${path}`;
};

/**
 * The settings from the environment, or a plain throw naming what is wrong:
 * this is a process that must not start. Every variable the relay needs is
 * checked here, so none of them fails later, in the middle of a call.
 */
export const settingsFrom = (env: NodeJS.ProcessEnv): RelaySettings => {
  const listen = listenFrom(env);
  if (listen.kind === "stdio") throw new Error("MCP_HTTP_PORT is not set: a relay listens on a port, where the clients of the server it stands in for connect");
  if (listen.kind === "public") throw new Error("MCP_HTTP_PUBLIC_HOSTS is set: a relay is for clients with a token, because it carries files and holds the token to the server");
  const files = FILES_VARIABLES.filter((name) => env[name]?.trim());
  if (files.length > 0) throw new Error(`${files.join(" and ")} configure a server's own file endpoints; a relay is told its folders by MCP_RELAY_INBOX and MCP_RELAY_OUTBOX`);
  const upstreamTokenFile = env["MCP_RELAY_UPSTREAM_TOKEN_FILE"]?.trim();
  if (!upstreamTokenFile) throw new Error("MCP_RELAY_UPSTREAM_TOKEN_FILE is not set: name the file that holds the bearer token the server accepts from this relay");
  const upstream = upstreamFrom(env["MCP_RELAY_UPSTREAM"]);
  const inbox = folderFrom(env, "MCP_RELAY_INBOX");
  const outbox = folderFrom(env, "MCP_RELAY_OUTBOX");
  const max = env["MCP_RELAY_MAX_FILE_BYTES"]?.trim();
  const maxFileBytes = max ? Number(max) : DEFAULT_FILES_MAX_BYTES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) throw new Error(`MCP_RELAY_MAX_FILE_BYTES "${max}" is not a number of bytes`);
  return {
    port: listen.port,
    ...(listen.host === undefined ? {} : { host: listen.host }),
    ...(listen.allowedHosts === undefined ? {} : { allowedHosts: listen.allowedHosts }),
    tokens: listen.tokens,
    upstream,
    upstreamTokenFile,
    ...(inbox === undefined ? {} : { inbox }),
    ...(outbox === undefined ? {} : { outbox }),
    maxFileBytes,
    limits: limitsFrom(env),
  };
};
