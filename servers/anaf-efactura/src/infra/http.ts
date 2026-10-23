import { bearer, type BearerTokens, type HttpFailure, type HttpOptions, type HttpRequest, makeHttp, redactCredentials } from "@foreverworks/mcp-kit";

import { apiError, fail, OUTCOME_UNKNOWN } from "../domain/errors.js";

/**
 * ANAF's side of the kit's HTTP client (packages/mcp-kit, http.ts): which
 * answers mean "later", and the failure each outcome becomes. The loop, the
 * backoff, the one renewal after a 401 and the never-twice rule for an upload
 * are the kit's.
 */

/**
 * 429 and 5xx are worth repeating. A 400 from FCTEL is not: it means the CIF,
 * the id or the XML is wrong, and those do not improve with waiting. 403 is the
 * role being absent from the grant, which is a console change, not a delay.
 */
const isRetryable = (status: number): boolean => status === 429 || status >= 500;

/**
 * ANAF's refusals are not JSON, and sometimes not even consistently XML. A
 * text body is carried through truncated, because the useful part is usually
 * a `<Errors errorMessage="...">` a human can read. Any credential it echoes is
 * blanked first: the text lands in a tool result (the kit does the same for
 * every error body; this covers the 200s that turn out to be failures).
 */
export const preview = (body: unknown): unknown => {
  if (typeof body !== "string") return body;
  const text = redactCredentials(body);
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
};

const asAnafFailure = (failure: HttpFailure): never => {
  switch (failure.kind) {
    case "transport":
      return fail(apiError(0, failure.message));
    case "outcome_unknown":
      return fail(apiError(failure.status, failure.message, { reason: OUTCOME_UNKNOWN, body: preview(failure.body) }));
    case "rate_limited":
      return fail(apiError(failure.status, failure.message));
    case "rejected":
      return fail(apiError(failure.status, failure.message, { body: preview(failure.body) }));
  }
};

/**
 * Four attempts of up to sixty seconds each: ANAF is a government API and slow
 * to recover, but nothing here is urgent either.
 */
const POLICY = { service: "ANAF", isRetryable, fail: asAnafFailure, attempts: 4, timeoutMs: 60_000 } as const;

/**
 * An authenticated request to ANAF. A token revoked before its stated expiry
 * earns exactly one forced refresh, after which a second 401 is believed.
 */
export const makeRequest = (tokens: BearerTokens, options: HttpOptions = {}): HttpRequest =>
  makeHttp({ ...POLICY, auth: bearer(tokens), ...options });

/**
 * A request to ANAF's public services (infra/config.ts, ANAF_PUBLIC): the same
 * policy with no bearer token, because they take none and a grant that has
 * run out must not stop them.
 */
export const makePublicRequest = (options: HttpOptions = {}): HttpRequest => makeHttp({ ...POLICY, ...options });

export type Request = HttpRequest;
