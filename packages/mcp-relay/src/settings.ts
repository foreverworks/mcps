import { type AllowedHost, type ClientTokenFiles, DEFAULT_FILES_MAX_BYTES, FILES_VARIABLES, folderFrom, isLoopbackAddress, type Limits, limitsFrom, listenFrom, MCP_PATH } from "@foreverworks/mcp-kit";

/**
 * Where the token the relay presents upstream comes from: one file, whose token
 * every client of the relay shares (MCP_RELAY_UPSTREAM_TOKEN_FILE), or a folder
 * with an `upstream-<client>` file for each client (MCP_RELAY_UPSTREAM_TOKENS_DIR),
 * so the server sees, and holds to its own limits, the client that really called.
 */
export type UpstreamTokenSource = { readonly kind: "file"; readonly file: string } | { readonly kind: "dir"; readonly dir: string };

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
  readonly upstreamTokens: UpstreamTokenSource;
  /** Whether the upstream is plain http to a host that is not this machine, which MCP_RELAY_ALLOW_PLAIN_HTTP=1 allowed. */
  readonly plainHttp: boolean;
  /** Where the clients put files the server's tools read by path. Absent: no file goes up. */
  readonly inbox?: string;
  /** Where files the server's tools hand back are put for the clients. Absent: no file comes down. */
  readonly outbox?: string;
  readonly maxFileBytes: number;
  /** The kit's limits on a client: request size, time and rate (MCP_HTTP_MAX_BODY, MCP_HTTP_TIMEOUT_MS, MCP_HTTP_RATE). */
  readonly limits: Limits;
};

/** MCP_RELAY_UPSTREAM: the server's base URL, as its operator gives it out; the relay adds `/mcp` and `/files/...`. */
const upstreamFrom = (raw: string | undefined, allowPlain: boolean): { readonly base: string; readonly plain: boolean } => {
  const value = raw?.trim();
  if (!value) throw new Error("MCP_RELAY_UPSTREAM is not set: write the base URL of the server this relay stands in for, for example https://mcp.example.com");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MCP_RELAY_UPSTREAM "${value}" is not a URL: write it in full, for example https://mcp.example.com`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`MCP_RELAY_UPSTREAM "${value}" is not an http or https URL`);
  if (url.username !== "" || url.password !== "") throw new Error("MCP_RELAY_UPSTREAM carries a user name or password: the token goes in a file named by MCP_RELAY_UPSTREAM_TOKEN_FILE, or in a folder named by MCP_RELAY_UPSTREAM_TOKENS_DIR");
  if (url.search !== "" || url.hash !== "") throw new Error("MCP_RELAY_UPSTREAM has a query or a fragment: write the base URL alone");
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/mcp")) throw new Error(`MCP_RELAY_UPSTREAM "${value}" ends in /mcp: write the server's base URL, without it`);
  // A token and the files would cross the network as they are written: only where the network is encrypted already.
  const plain = url.protocol === "http:" && !isLoopbackAddress(url.hostname.replace(/^\[|\]$/g, ""));
  if (plain && !allowPlain) {
    throw new Error(
      `MCP_RELAY_UPSTREAM "${value}" is plain http to a host that is not this machine, so the relay's token and the files would cross the network unencrypted: ` +
        "use https, or, on a network that is encrypted already (a VPN, an overlay), set MCP_RELAY_ALLOW_PLAIN_HTTP=1",
    );
  }
  return { base: `${url.origin}${path}`, plain };
};

/**
 * MCP_RELAY_UPSTREAM_TOKEN_FILE or MCP_RELAY_UPSTREAM_TOKENS_DIR, one of them.
 * Both would leave open which of the two a client's rights upstream come from,
 * and neither leaves no token to send, so each is a refusal that says which to
 * use and why: the choice is between clients that share one identity upstream
 * and clients the server can tell apart.
 */
const upstreamTokensFrom = (env: NodeJS.ProcessEnv): UpstreamTokenSource => {
  const file = env["MCP_RELAY_UPSTREAM_TOKEN_FILE"]?.trim();
  const dir = env["MCP_RELAY_UPSTREAM_TOKENS_DIR"]?.trim();
  if (file && dir) {
    throw new Error(
      "MCP_RELAY_UPSTREAM_TOKEN_FILE and MCP_RELAY_UPSTREAM_TOKENS_DIR are both set: set only one. " +
        "Use MCP_RELAY_UPSTREAM_TOKENS_DIR (an upstream-<client> file for each client) so the server sees each client under its own token and holds it to its own rights; " +
        "use MCP_RELAY_UPSTREAM_TOKEN_FILE when every client of this relay may have the rights of one token",
    );
  }
  if (dir) return { kind: "dir", dir };
  if (file) return { kind: "file", file };
  throw new Error(
    "MCP_RELAY_UPSTREAM_TOKEN_FILE is not set, and neither is MCP_RELAY_UPSTREAM_TOKENS_DIR: set one. " +
      "MCP_RELAY_UPSTREAM_TOKENS_DIR is a folder with an upstream-<client> file for each client, so the server sees each client under its own token and holds it to its own rights; " +
      "MCP_RELAY_UPSTREAM_TOKEN_FILE is one file whose token every client of this relay shares",
  );
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
  if (listen.path !== MCP_PATH) throw new Error(`MCP_HTTP_PATH is set: a relay answers on ${MCP_PATH} only, where the clients of the server it stands in for connect`);
  const files = FILES_VARIABLES.filter((name) => env[name]?.trim());
  if (files.length > 0) throw new Error(`${files.join(" and ")} configure a server's own file endpoints; a relay is told its folders by MCP_RELAY_INBOX and MCP_RELAY_OUTBOX`);
  const upstreamTokens = upstreamTokensFrom(env);
  const upstream = upstreamFrom(env["MCP_RELAY_UPSTREAM"], env["MCP_RELAY_ALLOW_PLAIN_HTTP"]?.trim() === "1");
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
    upstream: upstream.base,
    upstreamTokens,
    plainHttp: upstream.plain,
    ...(inbox === undefined ? {} : { inbox }),
    ...(outbox === undefined ? {} : { outbox }),
    maxFileBytes,
    limits: limitsFrom(env),
  };
};
