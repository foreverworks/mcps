import { backoffMs, retryAfterSeconds } from "@foreverworks/mcp-kit";

/** When Google says "later" rather than "no". Pure policy; no I/O, no timers. */

export const RETRY_ATTEMPTS = 5;

/**
 * Google answers a burst with 429, or with 403 plus one of these reasons. A
 * PLAIN 403 means the token lacks the scope, and waiting will not grant it.
 * Drive in particular says "not so fast" and "you may not" with the same 403,
 * and only the reason tells them apart; reading a rate limit as a permission
 * failure sends an operator to audit file ownership for nothing.
 */
const RATE_LIMIT_403 = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  // The google.rpc.ErrorInfo spelling Docs, Sheets and Slides use (see reasonOf).
  "RATE_LIMIT_EXCEEDED",
]);

export const isRateLimited = (status: number, reason: string | undefined): boolean =>
  status === 429 || (status === 403 && reason !== undefined && RATE_LIMIT_403.has(reason));

export const isRetryable = (status: number, reason: string | undefined): boolean =>
  isRateLimited(status, reason) || status >= 500 || (status === 403 && reason === "backendError");

export { backoffMs, retryAfterSeconds };
