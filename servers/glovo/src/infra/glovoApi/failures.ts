import type { HttpFailure } from "@foreverworks/mcp-kit";
import { notFound } from "@foreverworks/receipts/domain";

import { apiError, authError, fail, TOO_MANY_REQUESTS } from "../../domain/errors.js";
import type { RawError } from "../../domain/schema.js";

export const errorCodeOf = (body: unknown): string | undefined => {
  const code = (body as RawError | null | undefined)?.errorCode;
  return typeof code === "string" ? code : undefined;
};

const descriptionOf = (body: unknown): string | undefined => {
  const description = (body as RawError | null | undefined)?.errorDescription;
  return typeof description === "string" ? description : undefined;
};

/**
 * A failed API call as this server's failure; the kit's message names the
 * request. A 404 is an order this account does not have.
 */
export const asApiFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "rate_limited":
      return fail(apiError(failure.status, failure.message, failure.reason));
    case "outcome_unknown":
    case "rejected": {
      if (failure.status === 404) return fail(notFound(`${failure.message}: there is no such order in this account`));
      const why = descriptionOf(failure.body) ?? errorCodeOf(failure.body) ?? `HTTP ${failure.status}`;
      return fail(apiError(failure.status, `${failure.message}: ${why}`, errorCodeOf(failure.body)));
    }
  }
};

/**
 * A failed /oauth/refresh. A refusal (400/401/403) is a dead refresh token;
 * throttling, a 5xx or the network going away is transient. Only Glovo's error
 * code is ever quoted, never a body: a body here can be a credential.
 */
export const asRefreshFailure = (path: string) => (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(authError(0, `${path}: the network failed`, false));
    case "rate_limited":
      return fail(authError(failure.status, `${path} failed: ${failure.reason ?? `HTTP ${failure.status}`}`, false));
    case "outcome_unknown":
    case "rejected": {
      const transient = failure.status === TOO_MANY_REQUESTS || failure.status >= 500;
      const code = errorCodeOf(failure.body) ?? `HTTP ${failure.status}`;
      return fail(authError(failure.status, `${path} ${transient ? "failed" : "refused"}: ${code}`, !transient));
    }
  }
};
