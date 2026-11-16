import { Agent as HttpAgent, type IncomingHttpHeaders, type IncomingMessage, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { upstreamFileOf, type UpstreamTokens } from "./upstreamTokens.js";

/**
 * The relay's side of the wire to the server it stands in for: one place that
 * knows the base URL and the tokens, sends a request with the token of the
 * client it is for and nothing else of the client's, and puts every failure
 * into words that never hold a token. Effects live here and in the modules
 * that call it; what to send, and what an answer means, is decided elsewhere.
 */
export type Upstream = {
  /** Scheme, host, port and any path prefix, without a trailing slash. */
  readonly base: string;
  /** Whose requests these are: the client the relay knows by this name, and the upstream by this token. */
  readonly client: string;
  /** The token this client presents upstream. */
  readonly token: string;
  /** Whether the token is one for every client or this client's own, which changes what to tell a person whose token is refused. */
  readonly mode: UpstreamTokens["mode"];
  /** Every upstream token the relay holds, the longest first: all of them are taken out of anything the relay writes, whichever client's call it is about. */
  readonly secrets: readonly string[];
  readonly http: HttpAgent;
  readonly https: HttpsAgent;
};

/** The keep-alive pools every client shares: one set of connections to the upstream, whoever's token a request carries. */
export type Pool = { readonly http: HttpAgent; readonly https: HttpsAgent };

export type Upstreams = {
  readonly pool: Pool;
  /** One `Upstream` per client of the relay, all over the one pool. */
  readonly byClient: ReadonlyMap<string, Upstream>;
};

export const upstreamsAt = (base: string, tokens: UpstreamTokens): Upstreams => {
  const pool: Pool = { http: new HttpAgent({ keepAlive: true }), https: new HttpsAgent({ keepAlive: true }) };
  // Longest first, so a token that is the start of another leaves nothing of the longer one behind.
  const secrets = [...new Set(tokens.byClient.values())].sort((a, b) => b.length - a.length);
  return { pool, byClient: new Map([...tokens.byClient].map(([client, token]) => [client, { base, client, token, mode: tokens.mode, secrets, ...pool }])) };
};

export const closeUpstreams = ({ pool }: Upstreams): void => {
  pool.http.destroy();
  pool.https.destroy();
};

export type UpstreamRequest = {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** Below the base: `/mcp`, or `/files/inbox/a.txt`. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Buffer | Readable;
  readonly signal?: AbortSignal;
};

export type Answer = { readonly status: number; readonly headers: IncomingHttpHeaders; readonly body: IncomingMessage };

/** The answer, or the thrown reason the upstream could not be reached, or the request could not be sent whole. */
export const send = (upstream: Upstream, { method, path, headers = {}, body, signal }: UpstreamRequest): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const url = new URL(`${upstream.base}${path}`);
    const secure = url.protocol === "https:";
    const options = { method, headers: { ...headers, "accept-encoding": "identity", authorization: `Bearer ${upstream.token}` }, agent: secure ? upstream.https : upstream.http, ...(signal === undefined ? {} : { signal }) };
    const out = (secure ? httpsRequest : httpRequest)(url, options, (res) => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: res }));
    out.once("error", reject);
    if (body instanceof Readable) {
      // The upstream may answer before it has read it all (a file over its limit): that answer is the result, not this.
      pipeline(body, out).catch(() => undefined);
    } else {
      out.end(body);
    }
  });

/** The whole body of an answer, or undefined when it is longer than `maxBytes` (and then the rest is thrown away). */
export const readAnswer = async (answer: Answer, maxBytes: number): Promise<Buffer | undefined> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of answer.body as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      answer.body.destroy();
      return undefined;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

/** `text` with every upstream token, if it quotes one, taken out: an upstream's words can quote a token that is not this client's, and it must not reach this client. */
export const withoutTokens = (text: string, upstream: Upstream): string => upstream.secrets.reduce((kept, secret) => (secret === "" ? kept : kept.split(secret).join("[token]")), text);

/** A line of an upstream's text, fit to put in a message: no control characters, no token, not long. */
export const snippetOf = (body: Buffer, upstream: Upstream, max = 160): string => {
  const flat = withoutTokens(body.subarray(0, max * 4).toString("utf8"), upstream)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/** Why a request to the upstream threw, in a few words and without the token: a code if Node gave one. */
export const reasonOf = (error: unknown, upstream: Upstream): string => {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = [(error as { code?: unknown } | null)?.code, cause?.code].find((c): c is string => typeof c === "string");
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError" || code === "ABORT_ERR") return "the request was given up";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE") return "the connection was closed before the answer";
  return withoutTokens(code ?? (error instanceof Error ? error.message : String(error)), upstream);
};

/**
 * Where to look when the upstream refuses the token the relay presented, for a
 * person to read: the file or the client's file, never the token itself.
 */
const refusedWords = (status: number, upstream: Upstream): string =>
  upstream.mode === "one"
    ? `the upstream refused the relay's token (${status}); check MCP_RELAY_UPSTREAM_TOKEN_FILE`
    : `the upstream refused the relay's token for ${upstream.client} (${status}); check ${upstreamFileOf(upstream.client)} in MCP_RELAY_UPSTREAM_TOKENS_DIR`;

/**
 * Why the server's file endpoints turned this client away with a 403: the
 * client is held to a ceiling (MCP_CLIENT_MAX_ACCESS on the server), and files
 * cross outside the tool calls that ceiling checks. Such a client sends no
 * file, and fetches only the files its own calls handed back, while the server
 * still has the record of them. Not about the relay's token, so it must not
 * send anyone to look at the token files.
 */
const ceilingWords = (upstream: Upstream, direction: "upload" | "download"): string => {
  const who = upstream.mode === "one" ? "this client" : upstream.client;
  const held = `${upstream.mode === "one" ? "its" : `${who}'s`} calls are limited by a ceiling (MCP_CLIENT_MAX_ACCESS on the server), and files cross outside the tool calls that ceiling checks`;
  return direction === "upload"
    ? `the upstream takes no files from ${who} (403): ${held}, so uploads are for clients with no ceiling; use a client with none for a tool that takes a file`
    : `the upstream does not give ${who} this file (403): ${held}; a client held so fetches only the files its own calls handed back, while the server remembers those calls: if this file came from one of them, the server has since restarted or let the record go with its outbox's retention, so call the tool again`;
};

/** What a request was for: an upload to the file endpoints, a download from them, or the MCP route. */
export type Subject = "upload" | "download" | "call";

/**
 * What an answer other than the one wanted says about the upstream, for a
 * person to read. 401 is always about the relay's token, never the client's.
 * So is a 403 from the route; from a file endpoint it is the client's ceiling.
 */
export const statusWords = (status: number, upstream: Upstream, subject: Subject): string => {
  if (status === 403 && subject !== "call") return ceilingWords(upstream, subject);
  if (status === 401 || status === 403) return refusedWords(status, upstream);
  if (status === 404) return subject !== "call" ? "the upstream answered 404: its file endpoint is off, or the file is not there" : "the upstream answered 404: is MCP_RELAY_UPSTREAM the base URL of the server?";
  if (status === 413) return subject !== "call" ? "the upstream refused the file as too large (413); its MCP_HTTP_FILES_MAX_BYTES is the limit" : "the upstream refused the request as too large (413)";
  if (status === 421) return "the upstream does not answer to the name in MCP_RELAY_UPSTREAM (421); its MCP_HTTP_ALLOWED_HOSTS must list it";
  if (status === 422 && subject !== "call") return "the upstream received other bytes than were sent (422)";
  if (status === 429) return "the upstream is limiting this client's requests (429)";
  if (status >= 500) return `the upstream failed (${status})`;
  return `the upstream answered ${status}`;
};
