import { type HttpAuth, type HttpFailure, type HttpOptions, type HttpRequest, makeHttp, NOT_JSON, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

import { type AppError, fail } from "../domain/errors.js";
import { graphqlFailure, type GraphqlError } from "./graphqlErrors.js";

/**
 * EAS's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later" and what each failure becomes. The loop, the backoff,
 * Retry-After, the one renewal after a 401 and the rule that a change is never
 * sent twice blind are the kit's.
 *
 * Every request is a POST to one GraphQL endpoint, so what may be repeated is
 * said per request: a query is idempotent and repeats after a 5xx or a dropped
 * connection; a mutation does not, and fails as `outcome_unknown` instead.
 * A 401 is re-tried once after the token file is read again, so a replaced
 * token works without a restart.
 */

export type EasHttpOptions = HttpOptions & { readonly fetch?: typeof fetch };

const errorsIn = (body: unknown): readonly GraphqlError[] | undefined => {
  const errors = (body as { readonly errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.length > 0 ? (errors as GraphqlError[]) : undefined;
};

const failureFor = (failure: HttpFailure): AppError => {
  switch (failure.kind) {
    case "transport":
      return { kind: "api", status: 0, message: failure.message };
    case OUTCOME_UNKNOWN:
      return { kind: "outcome_unknown", message: failure.message };
    case "rate_limited":
      return { kind: "rate_limited", message: failure.message };
    case "rejected": {
      if (failure.reason === NOT_JSON) return { kind: "drift", message: `${failure.message}: the answer is not JSON` };
      if (failure.status === 401) return { kind: "auth", message: errorsIn(failure.body)?.[0]?.message ?? failure.message };
      // A GraphQL server answers a document it cannot validate with 400 and the same `errors` list.
      const errors = errorsIn(failure.body);
      if (errors !== undefined) return graphqlFailure(errors, { mutation: false, status: failure.status });
      if (failure.status === 403) return { kind: "forbidden", message: failure.message };
      return { kind: "api", status: failure.status, message: failure.message };
    }
  }
};

/** 5xx is worth another attempt for a query; the kit never repeats a mutation after one. */
const isRetryable = (status: number): boolean => status >= 500 && status !== 501;

export const makeEasHttp = (auth: HttpAuth | undefined, options: EasHttpOptions = {}): HttpRequest =>
  makeHttp({
    service: "EAS",
    ...(auth === undefined ? {} : { auth }),
    isRetryable,
    fail: (failure) => fail(failureFor(failure)),
    attempts: 4,
    timeoutMs: 60_000,
    headers: { "user-agent": "foreverworks-mcps/eas" },
    ...options,
  });
