/**
 * When a stored order detail can be trusted forever.
 *
 * A delivered order is not immutable the moment it is delivered: a refund
 * lands days later, on the same order id. So an order is stored only once it
 * has been in its final state for a week. Anything younger is refetched, which
 * costs one call for a recent order and nothing for the hundreds behind it.
 * Which states are final, and where the app says when one was reached, is each
 * app's (bolt-food and glovo, domain/freshness.ts).
 */
export const SETTLE_DAYS = 7;

const DAY_MS = 86_400_000;

/** Whether an order that reached its final state at `finalAtMs` has been there long enough. */
export const settledSince = (finalAtMs: number, nowMs: number): boolean => nowMs - finalAtMs >= SETTLE_DAYS * DAY_MS;
