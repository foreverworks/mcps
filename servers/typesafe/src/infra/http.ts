import { makeHttp, NOT_JSON, type HttpFailure, type HttpOptions, type HttpRequest } from "@foreverworks/mcp-kit";

import { driftError, fail, inputError } from "../domain/errors.js";

/**
 * TypeSafe's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later" and the failure each outcome becomes. The loop, the
 * backoff and Retry-After are the kit's.
 *
 * Every request here changes nothing on TypeSafe's side (an evaluation is a
 * read that is billed), so each is sent as idempotent: a 5xx or a dropped
 * connection is simply tried again. 429 and 529 (their "overloaded") are both
 * rate limits, as their own SDK retries them.
 */
const asTypesafeFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail({ kind: "api", status: 0, message: failure.message });
    case "outcome_unknown":
      return fail({ kind: "api", status: failure.status, message: failure.message, ...(failure.body === undefined ? {} : { body: failure.body }) });
    case "rate_limited":
      return fail({ kind: "rate_limited", status: failure.status, message: failure.message });
    case "rejected":
      if (failure.reason === NOT_JSON) return fail(driftError(`${failure.message}: the answer is not JSON`));
      if (failure.status === 401 || failure.status === 403) return fail({ kind: "auth", status: failure.status, message: failure.message });
      if (failure.status === 422 || failure.status === 400) return fail(inputError(failure.message, failure.body));
      return fail({ kind: "api", status: failure.status, message: failure.message, ...(failure.body === undefined ? {} : { body: failure.body }) });
  }
};

const isRateLimited = (status: number): boolean => status === 429 || status === 529;

export const makeTypesafeHttp = (apiKey: () => Promise<string>, options: HttpOptions & { readonly fetch?: typeof fetch } = {}): HttpRequest =>
  makeHttp({
    service: "TypeSafe",
    auth: { headers: async () => ({ authorization: `Bearer ${await apiKey()}` }) },
    isRetryable: (status) => isRateLimited(status) || status >= 500,
    isRateLimited,
    fail: asTypesafeFailure,
    // A call is 70-500 ms by their docs and under a second in practice; a minute is a hung connection.
    timeoutMs: 60_000,
    headers: { "user-agent": "foreverworks-mcps/typesafe" },
    ...options,
  });
