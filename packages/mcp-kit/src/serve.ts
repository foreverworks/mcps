import { timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { type NodeIncomingMessageLike, NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import { createMcpHandler, type Icon, isLegacyRequest, McpServer, type ProtocolEra } from "@modelcontextprotocol/server";
import { serveStdio as serveStdioEntry } from "@modelcontextprotocol/server/stdio";

import { describeSettings, type GuardSettings, guardSettingsFrom } from "./serve/confirm.js";
import { installEgress, installKeepAlive } from "./serve/egress.js";
import { guard, registeredNames, requestContext, type ServerVocabulary } from "./serve/guard.js";
import { toolIconsOf, type Product } from "./serve/icons.js";
import { admit, egressFrom, limitsFrom, type Bucket, type Limits } from "./serve/limits.js";
import { callerKey, checkPublic, clientIpHeaderFrom, hostAccepted, PUBLIC_CLIENT, publicHostsFrom, type PublicHost } from "./serve/public.js";
import { shareClientRoots, shareRootsOf } from "./clientRoots.js";
import { unclassified, type ToolPolicy } from "./policy.js";

/**
 * One entry point, two transports.
 *
 * stdio is the default: a session spawns the server and owns it. HTTP is the
 * same server run ONCE on the box, as a service every session connects to.
 * What a server registers does not change with the transport; only how it is
 * reached, and, over HTTP, who may reach it and how often: a client with a
 * bearer token, or, for a server that only reads public data, anyone
 * (serve/public.ts).
 */

/** Where the one HTTP route lives. Anything else is a 404. */
export const MCP_PATH = "/mcp";

/** Where the tokens come from: a directory of `token-<client>` files, or one file for one client. */
export type ClientTokenFiles =
  | { readonly kind: "dir"; readonly dir: string }
  | { readonly kind: "file"; readonly file: string; readonly client: string };

export type Listen =
  | { readonly kind: "stdio" }
  | { readonly kind: "http"; readonly port: number; readonly tokens: ClientTokenFiles }
  /** Anyone may call, with no sign-in, through a proxy that forwards these hosts; callers told apart by `clientIpHeader`, else the connection. */
  | { readonly kind: "public"; readonly port: number; readonly hosts: readonly PublicHost[]; readonly clientIpHeader?: string };

/**
 * The transport, read from the environment: MCP_HTTP_PORT switches to HTTP, and
 * then who may call is mandatory. Either MCP_HTTP_TOKENS_DIR (one
 * `token-<client>` file per client, as systemd's credentials directory holds
 * them) or MCP_HTTP_TOKEN_FILE (one token, for the client
 * MCP_HTTP_TOKEN_CLIENT, default `default`); or MCP_HTTP_PUBLIC_HOSTS, the
 * public names a proxy forwards, for a server anyone may call
 * (serve/public.ts), with MCP_HTTP_CLIENT_IP_HEADER naming the header that
 * carries each caller's address. Tokens and public hosts together are a
 * contradiction, and so are public hosts and file roots: with no sign-in,
 * anyone could read the files there through a tool that takes a path.
 *
 * A plain throw, not a tagged failure: this is a process that must not start.
 */
export const listenFrom = (env: NodeJS.ProcessEnv): Listen => {
  const port = env["MCP_HTTP_PORT"]?.trim();
  const publicHosts = env["MCP_HTTP_PUBLIC_HOSTS"]?.trim();
  if (!port) {
    if (publicHosts) throw new Error("MCP_HTTP_PUBLIC_HOSTS is set without MCP_HTTP_PORT: there is no HTTP listener to make public");
    return { kind: "stdio" };
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`MCP_HTTP_PORT "${port}" is not a port`);
  }
  const ipHeader = env["MCP_HTTP_CLIENT_IP_HEADER"]?.trim();
  const tokenSettings = ["MCP_HTTP_TOKENS_DIR", "MCP_HTTP_TOKEN_FILE"].filter((name) => env[name]?.trim());
  if (publicHosts) {
    if (tokenSettings.length > 0) {
      throw new Error(`MCP_HTTP_PUBLIC_HOSTS and ${tokenSettings.join(" and ")} are both set: a server is either open to anyone or behind tokens, not both`);
    }
    if (env["MCP_FILE_ROOTS"]?.trim()) {
      throw new Error("MCP_HTTP_PUBLIC_HOSTS and MCP_FILE_ROOTS are both set: with no sign-in, anyone could read the files there through a tool that takes a path");
    }
    return { kind: "public", port: parsed, hosts: publicHostsFrom(publicHosts), ...(ipHeader ? { clientIpHeader: clientIpHeaderFrom(ipHeader) } : {}) };
  }
  if (ipHeader) throw new Error("MCP_HTTP_CLIENT_IP_HEADER is set without MCP_HTTP_PUBLIC_HOSTS: a caller with a token is told apart by its token");
  const dir = env["MCP_HTTP_TOKENS_DIR"]?.trim();
  if (dir) return { kind: "http", port: parsed, tokens: { kind: "dir", dir } };
  const file = env["MCP_HTTP_TOKEN_FILE"]?.trim();
  if (file) return { kind: "http", port: parsed, tokens: { kind: "file", file, client: env["MCP_HTTP_TOKEN_CLIENT"]?.trim() || "default" } };
  throw new Error(
    "MCP_HTTP_PORT is set without MCP_HTTP_TOKENS_DIR or MCP_HTTP_TOKEN_FILE: the server would answer anyone on this machine " +
      "(MCP_HTTP_PUBLIC_HOSTS serves one whose tools only read, to anyone, on purpose)",
  );
};

/** client label -> token */
export type ClientTokens = ReadonlyMap<string, string>;

const TOKEN_PREFIX = "token-";

export const loadTokens = async (source: ClientTokenFiles): Promise<ClientTokens> => {
  const entries =
    source.kind === "file"
      ? [[source.client, (await readFile(source.file, "utf8")).trim()] as const]
      : await Promise.all(
          (await readdir(source.dir))
            .filter((name) => name.startsWith(TOKEN_PREFIX) && name.length > TOKEN_PREFIX.length)
            .sort()
            .map(async (name) => [name.slice(TOKEN_PREFIX.length), (await readFile(join(source.dir, name), "utf8")).trim()] as const),
        );
  // An EMPTY file is a client not configured here (systemd's SetCredential= fallback for a
  // LoadCredential= whose source is absent); a short one is a mistake.
  const present = entries.filter(([, token]) => token.length > 0);
  const short = present.filter(([, token]) => token.length < 16).map(([client]) => client);
  if (short.length > 0) throw new Error(`token too short for: ${short.join(", ")}`);
  if (present.length === 0) throw new Error("no tokens: nobody could call this server");
  return new Map(present);
};

/** Whether an Authorization header carries this token, compared in constant time. */
export const bearerMatches = (header: string | undefined, token: string): boolean => {
  const presented = Buffer.from(header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "");
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
};

/**
 * The client an Authorization header names, if any. Every token is compared, so
 * the time taken does not say which client's token was nearly right.
 *
 * The token is also what keeps a web page out. Loopback is reachable from any
 * browser on the box, but a page cannot send an Authorization header without a
 * CORS preflight, and this server answers the preflight with a 401 and no CORS
 * headers, so the browser never sends the real request.
 */
export const clientFor = (header: string | undefined, tokens: ClientTokens): string | undefined =>
  [...tokens].map(([client, token]) => (bearerMatches(header, token) ? client : undefined)).find((c) => c !== undefined);

export type ServeOptions = {
  readonly name: string;
  readonly version: string;
  /** What the server tells a client about itself at initialize (MCP "instructions"). */
  readonly instructions?: string;
  /** A person's name for the server, its home page and its icon, at initialize: `...packageIdentity(import.meta.url)`. */
  readonly title?: string;
  readonly websiteUrl?: string;
  readonly icons?: readonly Icon[];
  /**
   * For a server that serves several products (google: Gmail, Calendar, ...):
   * each product's icon on its tools in tools/list, as GitHub's server does
   * per toolset. A product's tools are its part of the policy.
   */
  readonly products?: readonly Product[];
  /**
   * Puts every tool on a fresh server: once over stdio, once PER REQUEST over
   * HTTP. Build the dependencies before calling `serve` and close over them, so
   * what a request pays for is registration and nothing else.
   */
  readonly register: (server: McpServer) => void;
  /** Every tool `register` registers, classified. Startup fails on a gap either way. */
  readonly policy: ToolPolicy;
  readonly env?: NodeJS.ProcessEnv;
  /** Replaces the ceiling and confirmation read from the environment (MCP_MAX_ACCESS, MCP_CONFIRM; tests). */
  readonly settings?: GuardSettings;
  /** Where audit lines go; stderr (the journal) by default. */
  readonly log?: (line: string) => void;
  /** The server's failures and remedies, for a money rule's `resolve` that fails before the tool runs (guard.ts). */
  readonly vocabulary?: ServerVocabulary;
};

export type Served = {
  /** The bound port over HTTP, which is the only way to learn it when asked for port 0. */
  readonly port?: number;
  /** The address bound over HTTP: always the loopback one, which a test holds it to. */
  readonly address?: string;
  readonly close: () => Promise<void>;
};

/** Refuse to start with a policy that does not match what is registered. */
export const checkPolicy = (name: string, register: (server: McpServer) => void, policy: ToolPolicy): void => {
  const registered = registeredNames(register);
  const missing = unclassified(policy, registered);
  const stale = Object.keys(policy).filter((tool) => !registered.includes(tool));
  if (missing.length > 0) throw new Error(`${name}: tools missing from the policy: ${missing.join(", ")}`);
  if (stale.length > 0) throw new Error(`${name}: the policy names tools nobody registers: ${stale.join(", ")}`);
};

const reply = (res: ServerResponse, status: number, message: string, headers: Readonly<Record<string, string>> = {}): void => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers }).end(`${message}\n`);
};

/** The body, or why not: too large, or not JSON. */
const readBody = (req: IncomingMessage, maxBytes: number): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly status: 400 | 413 }> =>
  new Promise((resolve) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > maxBytes) return resolve({ ok: false, status: 413 });
    const chunks: Buffer[] = [];
    const total = { bytes: 0 };
    req.on("data", (chunk: Buffer) => {
      total.bytes += chunk.length;
      if (total.bytes > maxBytes) {
        req.destroy();
        resolve({ ok: false, status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown });
      } catch {
        resolve({ ok: false, status: 400 });
      }
    });
    req.on("error", () => resolve({ ok: false, status: 400 }));
  });

type Runtime = {
  readonly options: ServeOptions;
  readonly toolIcons: ReadonlyMap<string, readonly Icon[]>;
  readonly settings: GuardSettings;
  readonly log: (line: string) => void;
};

/**
 * A server for one protocol generation (`era`: 2025-11-25 and before is
 * `legacy`, 2026-07-28 `modern`) on one transport, with every tool registered
 * through the guard. Whether the guard can put a question to the person at the
 * client in the middle of a call (a confirmation, a link to open) follows from
 * both: over stdio always (2025's server-to-client request, which the SDK
 * makes of the 2026 shape), and over HTTP only in 2026-07-28, where the
 * question is the call's own result and the client retries with the answer;
 * the stateless HTTP transport cannot carry a 2025 request back.
 */
const fresh = ({ options, toolIcons, settings, log }: Runtime, era: ProtocolEra, transport: "stdio" | "http"): McpServer => {
  const info = {
    name: options.name,
    version: options.version,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.websiteUrl === undefined ? {} : { websiteUrl: options.websiteUrl }),
    ...(options.icons === undefined ? {} : { icons: [...options.icons] }),
  };
  const server = new McpServer(info, options.instructions ? { instructions: options.instructions } : {});
  const midCall = transport === "stdio" || era === "modern";
  options.register(
    guard(server, {
      service: options.name,
      policy: options.policy,
      settings,
      log,
      midCall,
      icons: toolIcons,
      ...(options.vocabulary === undefined ? {} : { vocabulary: options.vocabulary }),
    }),
  );
  return server;
};

/**
 * One client over stdio, in the protocol generation its first message picks
 * (an `initialize` is 2025, a request carrying 2026-07-28's `_meta` is the
 * new one). The SDK builds the server for that generation and keeps it for
 * the connection; it may build one more first to answer a `server/discover`
 * probe, which costs registration only.
 */
const serveStdio = async (runtime: Runtime): Promise<Served> => {
  const { name } = runtime.options;
  const handle = serveStdioEntry(
    ({ era }) => {
      const server = fresh(runtime, era, "stdio");
      // A 2025 client shares its folders as roots and says when they change; set up before the
      // SDK connects the server, so a change announced at once is not missed. 2026-07-28 deprecated
      // roots and has no way to push them, so there the deployment's roots decide (clientRoots.ts).
      if (era === "legacy") shareRootsOf(server);
      return server;
    },
    {
      onerror: (error: Error) => {
        console.error(`${name}: stdio failed:`, error);
        process.exitCode = 1;
      },
    },
  );
  // stderr: over stdio, stdout IS the protocol.
  console.error(`${name}: on stdio, protocol 2025-11-25 or 2026-07-28 as the client opens; ${describeSettings(runtime.settings)}`);
  return {
    close: async () => {
      shareClientRoots(undefined);
      await handle.close();
    },
  };
};

/**
 * Whether a request asks to hear how a call is going: a tools/call carrying a
 * progressToken. Such a request is answered as a stream (SSE), the only way
 * the notifications reach the client before the result; every other request
 * gets one JSON response, since the transport drops notifications in that mode.
 */
export const asksProgress = (body: unknown): boolean =>
  (Array.isArray(body) ? body : [body]).some((message) => {
    const m = message as { readonly method?: unknown; readonly params?: { readonly _meta?: { readonly progressToken?: unknown } } } | null;
    return m?.method === "tools/call" && m.params?._meta?.progressToken !== undefined;
  });

/**
 * Who may come in over HTTP: how a request names its caller, or is turned
 * away (undefined: a 401), which public Host headers it may carry besides the
 * loopback ones, and how the startup line says so.
 */
type Door = {
  /** The caller's client name, for the guard and the audit line, and the key its rate limit counts under. */
  readonly callerOf: (req: IncomingMessage) => { readonly client: string; readonly bucket: string } | undefined;
  readonly publicHosts: readonly PublicHost[];
  readonly describe: string;
};

/** A client presents its bearer token; its name is its identity and its bucket. */
const tokenDoor = (tokens: ClientTokens): Door => ({
  callerOf: (req) => {
    const client = clientFor(req.headers.authorization, tokens);
    return client === undefined ? undefined : { client, bucket: client };
  },
  publicHosts: [],
  describe: `for ${[...tokens.keys()].join(", ")}`,
});

/** Anyone comes in, all as the one client `public`; each address has its own bucket. */
const publicDoor = (hosts: readonly PublicHost[], clientIpHeader: string | undefined): Door => ({
  callerOf: (req) => ({
    client: PUBLIC_CLIENT,
    bucket: callerKey(clientIpHeader === undefined ? undefined : req.headers[clientIpHeader], req.socket.remoteAddress),
  }),
  publicHosts: hosts,
  describe:
    `for anyone, with no sign-in, as ${hosts.map((h) => (h.port === 443 ? h.name : `${h.name}:${h.port}`)).join(", ")}; ` +
    (clientIpHeader === undefined
      ? "callers told apart by the connection's address (behind a proxy that is the proxy's: set MCP_HTTP_CLIENT_IP_HEADER)"
      : `callers told apart by ${clientIpHeader}`),
});

/**
 * Stateless: no session id, and a fresh server per request. Nothing about a
 * connection outlives its request, so a restart of the service costs a session
 * only the call that was in flight, and a client that hangs up cancels its
 * call (the request's signal aborts with the response).
 *
 * Both protocol generations on the one route, told apart by the body: a
 * request carrying 2026-07-28's `_meta` goes to the SDK's handler for that
 * revision (which answers JSON, or a stream once a call reports progress),
 * everything else is 2025-11-25 and earlier, served here as before: JSON
 * responses, or a stream for a call that asks for progress (asksProgress).
 * Kept so because plain clients (a script with curl) read one JSON answer.
 */
const serveHttp = async (runtime: Runtime, port: number, door: Door, limits: Limits): Promise<Served> => {
  const { options } = runtime;
  const buckets = new Map<string, Bucket>();
  const state = { bound: 0 };
  const onerror = (error: Error): void => console.error(`${options.name}: request failed:`, error);
  const modern = createMcpHandler(({ era }) => fresh(runtime, era, "http"), { legacy: "reject", onerror, maxRequestBodySize: limits.maxBodyBytes });
  const serveModern = toNodeHandler(modern, { onerror, maxRequestBodySize: limits.maxBodyBytes });

  const answer = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const caller = door.callerOf(req);
    if (caller === undefined) return reply(res, 401, "unauthorized");
    const { client } = caller;
    // A DNS-rebinding page cannot present a token anyway; this refuses a stray Host too, and on a public server it is the only check.
    if (!hostAccepted(req.headers.host, state.bound, door.publicHosts)) return reply(res, 421, "wrong host");
    if (new URL(req.url ?? "/", "http://localhost").pathname !== MCP_PATH) return reply(res, 404, "not found");
    // Also a CORS preflight, answered with no CORS headers: ChatGPT and Claude call from their servers, never from a page.
    if (req.method !== "POST") return reply(res, 405, "stateless server: POST only");

    const step = admit(buckets, caller.bucket, Date.now(), limits);
    if (!step.allowed) return reply(res, 429, "too many requests", { "retry-after": String(step.retryAfterSec) });

    const read = await readBody(req, limits.maxBodyBytes);
    if (!read.ok) return reply(res, read.status, read.status === 413 ? `body larger than ${limits.maxBodyBytes} bytes` : "not JSON");

    // Node's request types a method as optional; the SDK's adapter wants it, and a request always has one.
    const incoming = req as NodeIncomingMessageLike;
    const legacy = await isLegacyRequest(await toWebRequest(incoming, read.body), read.body);
    const server = legacy ? fresh(runtime, "legacy", "http") : undefined;
    res.on("close", () => void server?.close());
    const timer = setTimeout(() => {
      if (!res.headersSent) reply(res, 504, `no answer within ${limits.timeoutMs} ms`);
      void server?.close();
    }, limits.timeoutMs);
    try {
      if (server === undefined) {
        await requestContext.run({ client }, () => serveModern(incoming, res, read.body));
        return;
      }
      // No session id generator is what makes the transport stateless.
      const transport = new NodeStreamableHTTPServerTransport({ enableJsonResponse: !asksProgress(read.body) });
      await server.connect(transport);
      await requestContext.run({ client }, () => transport.handleRequest(req, res, read.body));
    } catch (error: unknown) {
      console.error(`${options.name}: request failed:`, error);
      if (!res.headersSent) reply(res, 500, "internal error");
    } finally {
      clearTimeout(timer);
    }
  };

  const http = createServer((req, res) => void answer(req, res));
  // A client that trickles its REQUEST cannot hold a socket either; the handler's own limit is above.
  http.requestTimeout = 30_000;
  http.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", resolve);
  });
  const bound = (http.address() as AddressInfo).port;
  state.bound = bound;
  // stderr, never stdout: the rule every server here keeps, whatever the transport.
  console.error(`${options.name}: listening on http://127.0.0.1:${bound}${MCP_PATH} ${door.describe}; ${describeSettings(runtime.settings)}`);
  return {
    port: bound,
    address: (http.address() as AddressInfo).address,
    close: async () => {
      await modern.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
};

export const serve = async (options: ServeOptions): Promise<Served> => {
  const env = options.env ?? process.env;
  checkPolicy(options.name, options.register, options.policy);
  const listen = listenFrom(env);
  const settings = options.settings ?? guardSettingsFrom(env);
  if (listen.kind === "public") checkPublic(options.name, options.policy, settings);
  const egress = egressFrom(env);
  if (egress !== undefined) installEgress(egress);
  installKeepAlive(env);
  const runtime: Runtime = {
    options,
    toolIcons: toolIconsOf(options.name, options.policy, options.products ?? []),
    settings,
    log: options.log ?? ((line: string) => console.error(line)),
  };
  switch (listen.kind) {
    case "stdio":
      return serveStdio(runtime);
    case "http":
      return serveHttp(runtime, listen.port, tokenDoor(await loadTokens(listen.tokens)), limitsFrom(env));
    case "public":
      return serveHttp(runtime, listen.port, publicDoor(listen.hosts, listen.clientIpHeader), limitsFrom(env));
  }
};
