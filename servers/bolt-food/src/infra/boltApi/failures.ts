import type { HttpFailure } from "@foreverworks/mcp-kit";

import { apiError, authError, fail, TOO_MANY_REQUESTS } from "../../domain/errors.js";
import { codeOf, messageOf } from "./envelope.js";

/** A failed API call as this server's failure. A dead network is status 0, which stops a batch. */
export const asApiFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "rate_limited":
      // Bolt throttles at HTTP 200 (envelope.ts made it a 429 for the kit).
      return fail(apiError(200, failure.message, TOO_MANY_REQUESTS));
    case "outcome_unknown":
    case "rejected":
      return fail(apiError(failure.status, `${failure.message}: ${messageOf(failure.body) ?? "no message"}`, codeOf(failure.body)));
  }
};

/**
 * A failed getAccessToken. Bolt documents none of its codes, so a refusal is
 * taken as a dead refresh token (permanent: a human re-extracts it); throttling
 * and a 5xx are transient, and a dead network is the same status 0 as anywhere.
 */
export const asMintFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "rate_limited":
      return fail(authError(TOO_MANY_REQUESTS, `getAccessToken: ${failure.message}`, false));
    case "outcome_unknown":
    case "rejected": {
      const transient = failure.status >= 500;
      const why = messageOf(failure.body) ?? `HTTP ${failure.status}`;
      return fail(authError(codeOf(failure.body) ?? failure.status, `getAccessToken ${transient ? "failed" : "refused"}: ${why}`, !transient));
    }
  }
};
