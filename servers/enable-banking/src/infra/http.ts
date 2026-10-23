import { makeHttp, type HttpFailure, type HttpOptions, type Query, type Sleep } from "@foreverworks/mcp-kit";

import { apiError, fail, OUTCOME_UNKNOWN, required } from "../domain/errors.js";
import type { Signer } from "./jwt.js";

/**
 * Enable Banking's side of the kit's HTTP client (packages/mcp-kit, http.ts):
 * how a request is signed, which answers mean "later", where an error names its
 * reason, and the failure each outcome becomes. The loop, the backoff,
 * Retry-After and the never-twice rule for a POST are the kit's.
 */

export type { Query, Sleep };

/** Four attempts: three waits of the kit's backoff, then the answer stands. */
const RETRY_ATTEMPTS = 4;

/**
 * 5xx is worth repeating (429 is the kit's rate-limit path). A 422 is a lapsed
 * consent and ASPSP_RATE_LIMIT_EXCEEDED the bank's DAILY allowance; waiting
 * seconds fixes neither, and every retry of a bank call spends that allowance.
 */
const isRetryable = (status: number): boolean => status >= 500;

/**
 * Enable Banking's error code (`EXPIRED_SESSION`, `WRONG_AUTHORIZATION_CODE`,
 * ...), from its documented ErrorResponse. It is the part of a refusal that says
 * what to do, which the status alone does not.
 */
export const reasonOf = (body: unknown): string | undefined => {
  const error = typeof body === "object" && body !== null ? (body as { readonly error?: unknown }).error : undefined;
  return typeof error === "string" && error !== "" ? error : undefined;
};

const asFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "outcome_unknown":
      return fail(apiError(failure.status, failure.message, { reason: OUTCOME_UNKNOWN, body: failure.body }));
    case "rate_limited":
      return fail(apiError(failure.status, failure.message, { reason: failure.reason }));
    case "rejected":
      return fail(apiError(failure.status, failure.message, { reason: failure.reason, body: failure.body }));
  }
};

export type RequestSpec = {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly query?: Query;
  readonly body?: unknown;
};

/**
 * A request signed with a JWT minted per ATTEMPT: one lives five minutes, and a
 * retry after a long backoff must not present an expired one. There is nothing
 * to renew after a 401 (the key either works or it does not), so a 401 is final.
 *
 * The body of a 2xx is returned as the type the caller names, which is the
 * published schema's claim about that endpoint (domain/schema.ts). An empty 2xx
 * is an api failure: no endpoint this server calls answers with nothing. A 2xx
 * that is not JSON (a gateway's HTML page) is the kit's `not_json` refusal.
 */
export const makeRequest = (sign: Signer, apiBase: () => Promise<string>, options: HttpOptions = {}) => {
  const http = makeHttp({
    service: "Enable Banking",
    auth: { headers: async () => ({ Authorization: `Bearer ${await sign()}` }) },
    headers: { Accept: "application/json" },
    isRetryable,
    reasonOf,
    fail: asFailure,
    attempts: RETRY_ATTEMPTS,
    timeoutMs: 30_000,
    ...options,
  });

  return async <T>(spec: RequestSpec): Promise<T> => {
    const what = `${spec.method} ${spec.path}`;
    const answer = await http<T | undefined>(`${await apiBase()}${spec.path}`, {
      method: spec.method,
      ...(spec.query === undefined ? {} : { query: spec.query }),
      ...(spec.body === undefined ? {} : { json: spec.body }),
    });
    // DELETE answers {"message": "OK"} by the spec; an empty 2xx says the same and is not a failure.
    return spec.method === "DELETE" ? (answer as T) : required(answer, `body (${what})`);
  };
};

export type Request = ReturnType<typeof makeRequest>;
