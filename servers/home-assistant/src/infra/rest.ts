import { type HttpFailure, makeHttp, NOT_JSON, type RequestSpec, type Sleep } from "@foreverworks/mcp-kit";

import { type AppError, drift, fail } from "../domain/errors.js";
import { apiUrl, type Connection, egressHostOf } from "./connection.js";

/**
 * Home Assistant's REST API on the kit's HTTP client, with this API's policy:
 *
 * - 401 and 403 are final, never retried, and no renewal is tried: a
 *   long-lived token cannot be renewed, and each refusal is a failed login
 *   (connection.ts remembers it).
 * - 502, 503 and 504 (a proxy in front, Home Assistant restarting) are worth
 *   one more try for a read; an action is never sent twice (the kit's rule).
 * - Home Assistant's errors carry `{"message": ...}`, or aiohttp's plain
 *   "400: Bad Request"; either is the reason a failure shows.
 */

export type RestOptions = {
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  readonly random?: () => number;
};

export type RestSpec = RequestSpec & {
  readonly timeoutMs?: number;
  /** What a 404 means for this path; without it, an endpoint whose integration is not loaded. */
  readonly notFound?: () => AppError;
};

export type Rest = <T>(path: string, spec?: RestSpec) => Promise<T>;

export const READ_TIMEOUT_MS = 30_000;

/** Home Assistant's own message in an error body, or aiohttp's text. */
export const messageOf = (body: unknown): string | undefined => {
  if (typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string") return (body as { message: string }).message;
  if (typeof body === "string" && body.trim() !== "") return body.trim().slice(0, 300);
  return undefined;
};

const causes = (thrown: unknown): readonly unknown[] => {
  const chain: unknown[] = [];
  for (let at: unknown = thrown; at !== undefined && at !== null && chain.length < 6; at = (at as { cause?: unknown }).cause) chain.push(at);
  return chain;
};

/**
 * A failed fetch in words a person can act on: undici says only "fetch
 * failed", and keeps ECONNREFUSED or ENOTFOUND in its cause.
 */
export const describeFetchError = (thrown: unknown): string => {
  const chain = causes(thrown);
  if (chain.some((c) => (c as { name?: unknown }).name === "TimeoutError")) return "timed out";
  const code = chain.map((c) => (c as { code?: unknown }).code).find((c): c is string => typeof c === "string");
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return code === undefined ? message : `${message} (${code})`;
};

const failureOf = (f: HttpFailure, path: string, host: string, timeoutMs: number, notFound: (() => AppError) | undefined): AppError => {
  switch (f.kind) {
    case "transport":
      return {
        kind: "unreachable",
        message: f.message.endsWith(": timed out") ? `Home Assistant at ${host} did not answer within ${Math.round(timeoutMs / 1000)} s` : `could not reach Home Assistant at ${host}: ${f.message.replace(/^.*?: /, "")}`,
      };
    case "outcome_unknown": {
      const said = messageOf(f.body);
      return { kind: "outcome_unknown", message: `${f.message}${said === undefined ? "" : ` (Home Assistant said: ${said})`}` };
    }
    case "rate_limited":
      return { kind: "unavailable", status: f.status, message: f.message };
    case "rejected": {
      const said = messageOf(f.body);
      if (f.status === 401) return { kind: "auth", status: 401, sent: true, message: `Home Assistant refused the token (401)${said === undefined ? "" : `: ${said}`}` };
      if (f.status === 403) return { kind: "auth", status: 403, sent: true, message: `Home Assistant refused this address (403)${said === undefined ? "" : `: ${said}`}` };
      if (f.reason === NOT_JSON) return drift(`${host} answered ${path} with something that is not Home Assistant's JSON: ${String(f.body).slice(0, 200)}`);
      if (f.status === 404) return notFound?.() ?? { kind: "not_found", what: "endpoint", name: path, message: `Home Assistant has no ${path}${said === undefined ? "" : `: ${said}`}` };
      if (f.status >= 500) return { kind: "unavailable", status: f.status, message: `Home Assistant answered ${path} with ${f.status}${said === undefined ? "" : `: ${said}`}` };
      return { kind: "rejected", status: f.status, message: said ?? `Home Assistant refused ${path} (${f.status})` };
    }
  }
};

export const makeRest = (conn: Connection, options: RestOptions = {}): Rest => {
  const inner = options.fetch ?? fetch;
  const described = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    inner(input, init).catch((thrown: unknown) => {
      throw new Error(describeFetchError(thrown));
    })) as typeof fetch;

  return async <T>(path: string, spec: RestSpec = {}): Promise<T> => {
    const base = conn.base();
    const host = egressHostOf(base);
    const url = apiUrl(base, path).toString();
    const timeoutMs = spec.timeoutMs ?? READ_TIMEOUT_MS;
    return conn.withToken((token) =>
      makeHttp({
        service: "Home Assistant",
        auth: { headers: async () => ({ Authorization: `Bearer ${token}` }) },
        isRetryable: (status) => status === 502 || status === 503 || status === 504,
        reasonOf: messageOf,
        fail: (f) => fail(failureOf(f, path, host, timeoutMs, spec.notFound)),
        attempts: 2,
        timeoutMs,
        fetch: described,
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        ...(options.random === undefined ? {} : { random: options.random }),
      })<T>(url, spec),
    );
  };
};
