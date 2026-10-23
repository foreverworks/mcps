import { bearer, makeHttp, type HttpFailure, type HttpRequest, type Query, type RequestSpec, type Sleep } from "@foreverworks/mcp-kit";

import { apiError, fail, OUTCOME_UNKNOWN, quotaError } from "../domain/errors.js";
import type { TokenProvider } from "./oauth.js";
import { isRateLimited, isRetryable, RETRY_ATTEMPTS } from "./retry.js";

/**
 * Google's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later", where a Google error names its reason, and the failure
 * each outcome becomes. The loop itself, the backoff and the never-twice rule
 * for a send are the kit's.
 */

export type { Query, RequestSpec, Sleep };

/** What a request needs from a token source: one now, and a fresh one after a 401. */
export type Tokens = Pick<TokenProvider, "get" | "force">;

/**
 * Google's machine-readable reason, when the body carries one. A quota refusal
 * sometimes carries only prose ("Quota exceeded for quota metric ..."), which
 * Drive was seen to send; that one is named here so it is retried as a rate
 * limit rather than reported as a permission failure.
 */
export const reasonOf = (body: unknown): string | undefined => {
  const error = (
    body as { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[]; message?: string } }
  )?.error;
  // Docs, Sheets and Slides answer in the newer shape: no `errors` array, the
  // reason inside a google.rpc.ErrorInfo in `details` (SERVICE_DISABLED for an
  // API the Cloud project has not enabled). The older array wins when both are there.
  return (
    error?.errors?.[0]?.reason ??
    error?.details?.find((d) => typeof d?.reason === "string")?.reason ??
    (/quota exceeded/i.test(error?.message ?? "") ? "quotaExceeded" : undefined)
  );
};

const asGoogleFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "outcome_unknown":
      return fail(apiError(failure.status, failure.message, { reason: OUTCOME_UNKNOWN, body: failure.body }));
    case "rate_limited":
      return fail(quotaError(failure.message));
    case "rejected":
      return fail(apiError(failure.status, failure.message, { reason: failure.reason, body: failure.body }));
  }
};

export type HttpOptions = {
  readonly timeoutMs?: number;
  readonly sleep?: Sleep;
  /** Which Google product is on the other end, named in every failure message. */
  readonly service?: string;
  /**
   * The least a rate-limit refusal waits. Drive's quota is PER MINUTE, so the
   * general curve (1s, 2s, 4s, 8s) spends every attempt before the bucket
   * refills; measured: the first three calls a fresh client made to Drive
   * were all refused. 0 elsewhere.
   */
  readonly quotaFloorMs?: number;
};

/**
 * An authenticated request to a Google API. A token revoked before its cached
 * expiry earns exactly one forced refresh, after which a second 401 is believed.
 */
export const makeRequest = (tokens: Tokens, { timeoutMs = 30_000, sleep, service = "Google", quotaFloorMs = 0 }: HttpOptions = {}): HttpRequest =>
  makeHttp({
    service,
    auth: bearer(tokens),
    isRetryable,
    isRateLimited,
    reasonOf,
    fail: asGoogleFailure,
    attempts: RETRY_ATTEMPTS,
    timeoutMs,
    quotaFloorMs,
    ...(sleep ? { sleep } : {}),
  });

export type Request = HttpRequest;

/** The read path's shape, kept because every read adapter is written against it. */
export const makeGetJson = (tokens: Tokens, options: HttpOptions = {}) => {
  const request = makeRequest(tokens, options);
  return <T>(url: string, query: Query = {}): Promise<T> => request<T>(url, { query });
};

export type GetJson = ReturnType<typeof makeGetJson>;
