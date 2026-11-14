import { Agent as HttpAgent, type IncomingHttpHeaders, type IncomingMessage, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The relay's side of the wire to the server it stands in for: one place that
 * knows the base URL and the token, sends a request with the token and
 * nothing else of the client's, and puts every failure into words that never
 * hold the token. Effects live here and in the modules that call it; what to
 * send, and what an answer means, is decided elsewhere.
 */
export type Upstream = {
  /** Scheme, host, port and any path prefix, without a trailing slash. */
  readonly base: string;
  readonly token: string;
  readonly http: HttpAgent;
  readonly https: HttpsAgent;
};

export const upstreamAt = (base: string, token: string): Upstream => ({
  base,
  token,
  http: new HttpAgent({ keepAlive: true }),
  https: new HttpsAgent({ keepAlive: true }),
});

export const closeUpstream = (upstream: Upstream): void => {
  upstream.http.destroy();
  upstream.https.destroy();
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

/** `text` with the upstream's token, if it quotes it, taken out. */
export const withoutToken = (text: string, upstream: Upstream): string => (upstream.token === "" ? text : text.split(upstream.token).join("[token]"));

/** A line of an upstream's text, fit to put in a message: no control characters, no token, not long. */
export const snippetOf = (body: Buffer, upstream: Upstream, max = 160): string => {
  const flat = withoutToken(body.subarray(0, max * 4).toString("utf8"), upstream)
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
  return withoutToken(code ?? (error instanceof Error ? error.message : String(error)), upstream);
};

/**
 * What an answer other than the one wanted says about the upstream, for a
 * person to read: `file` for the file endpoints, `call` for the MCP route.
 * 401 and 403 are always about the relay's token, never the client's.
 */
export const statusWords = (status: number, subject: "file" | "call" = "file"): string => {
  if (status === 401 || status === 403) return `the upstream refused the relay's token (${status}); check MCP_RELAY_UPSTREAM_TOKEN_FILE`;
  if (status === 404) return subject === "file" ? "the upstream answered 404: its file endpoint is off, or the file is not there" : "the upstream answered 404: is MCP_RELAY_UPSTREAM the base URL of the server?";
  if (status === 413) return subject === "file" ? "the upstream refused the file as too large (413); its MCP_HTTP_FILES_MAX_BYTES is the limit" : "the upstream refused the request as too large (413)";
  if (status === 421) return "the upstream does not answer to the name in MCP_RELAY_UPSTREAM (421); its MCP_HTTP_ALLOWED_HOSTS must list it";
  if (status === 422 && subject === "file") return "the upstream received other bytes than were sent (422)";
  if (status === 429) return "the upstream is limiting this client's requests (429)";
  if (status >= 500) return `the upstream failed (${status})`;
  return `the upstream answered ${status}`;
};
