import { type HttpAuth, type HttpFailure, type HttpOptions, type HttpRequest, makeHttp, NOT_JSON, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

import { type AppError, fail, needsLogin } from "../domain/errors.js";

/**
 * The portal's side of the kit's HTTP client (packages/mcp-kit, http.ts):
 * which answers mean "later" and what each failure becomes. The loop, the
 * backoff, the one renewal after a 401 and the rule that a change is never
 * sent twice blind are the kit's.
 *
 * A 401 is re-tried once after the session is refreshed (the kit's renewal);
 * a second 401 means the portal no longer honours this session, which is
 * `needs_login`, not an API error: the remedy is the user's browser.
 */
export type PortalHttpOptions = HttpOptions & { readonly fetch?: typeof fetch };

const failureFor = (failure: HttpFailure): AppError => {
  switch (failure.kind) {
    case "transport":
      return { kind: "api", status: 0, message: failure.message };
    case OUTCOME_UNKNOWN:
      return { kind: "api", status: failure.status, message: failure.message };
    case "rate_limited":
      return { kind: "rate_limited", message: failure.message };
    case "rejected": {
      if (failure.reason === NOT_JSON) return { kind: "drift", message: `${failure.message}: the answer is not JSON` };
      if (failure.status === 401) return needsLogin("refused", "the portal refused the session's token even after a refresh");
      if (failure.status === 403) return { kind: "forbidden", message: failure.message };
      if (failure.status === 404) return { kind: "not_found", message: failure.message };
      if (failure.status === 400 || failure.status === 422) return { kind: "input", message: failure.message };
      return { kind: "api", status: failure.status, message: failure.message };
    }
  }
};

/** 5xx is worth another attempt: every call here is a read. */
const isRetryable = (status: number): boolean => status >= 500 && status !== 501;

export const makePortalHttp = (auth: HttpAuth, options: PortalHttpOptions = {}): HttpRequest =>
  makeHttp({
    service: "the ONRC portal",
    auth,
    isRetryable,
    fail: (failure) => fail(failureFor(failure)),
    attempts: 4,
    timeoutMs: 30_000,
    headers: { accept: "application/json", "user-agent": "foreverworks-mcps/onrc" },
    ...options,
  });
