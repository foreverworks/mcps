/**
 * When a remote says "later" rather than "no".
 *
 * Pure policy: no I/O, no timers, no clock. The caller decides what is
 * retryable, because that is API-specific (a plain 403 from Gmail is a missing
 * scope, a 422 from Enable Banking is a lapsed consent, and neither improves
 * with waiting); what is shared is the schedule.
 */

const MAX_BACKOFF_MS = 32_000;

/**
 * Honour `Retry-After` when the server sent one, otherwise exponential.
 *
 * The jitter is not decoration. Several copies of a server (one per session
 * over stdio) share an API's rate limit, which releases them all at the same
 * instant, so an unjittered schedule has them collide on every attempt.
 */
export const backoffMs = (
  attempt: number,
  retryAfterSeconds: number | undefined,
  { maxMs = MAX_BACKOFF_MS, jitterMs = 1000, random = Math.random }: Backoff = {},
): number => {
  const base = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : Math.min(2 ** attempt * 1000, maxMs);
  return base + random() * jitterMs;
};

export type Backoff = {
  readonly maxMs?: number;
  readonly jitterMs?: number;
  readonly random?: () => number;
};

/** A `Retry-After` header in seconds. Undefined for absent, junk, or a date. */
export const retryAfterSeconds = (header: string | null): number | undefined => {
  if (header === null || header === "") return undefined;
  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
