import { daysBetween, isIsoDate } from "./dates.js";
import { fail, inputError } from "./errors.js";

export type DateRange = { readonly since?: string; readonly until?: string };

/** A calendar quarter plus slack: a month's accounting never needs more in one call. */
export const MAX_RECEIPT_DAYS = 93;

/**
 * Validates an optional local-date range. `maxDays` bounds the calls that fetch
 * a detail per order: an unbounded range on a cold store is minutes of paced
 * requests, which reads as a hung tool.
 */
export const parseRange = (since: string | undefined, until: string | undefined, maxDays?: number): DateRange => {
  for (const [name, value] of [["since", since], ["until", until]] as const) {
    if (value !== undefined && !isIsoDate(value)) fail(inputError(`${name} must be YYYY-MM-DD, got "${value}"`));
  }
  if (since !== undefined && until !== undefined && since > until) fail(inputError(`since ${since} is after until ${until}`));
  if (maxDays !== undefined) {
    if (since === undefined || until === undefined) fail(inputError("since and until are both required here"));
    else if (daysBetween(since, until) + 1 > maxDays) fail(inputError(`the range spans more than ${maxDays} days; split it`));
  }
  return { ...(since !== undefined ? { since } : {}), ...(until !== undefined ? { until } : {}) };
};

/** Whether a local date lies in the range; an open end admits everything on that side. */
export const inRange = (date: string, range: DateRange): boolean =>
  (range.since === undefined || date >= range.since) && (range.until === undefined || date <= range.until);
