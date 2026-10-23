/**
 * Calendar arithmetic on YYYY-MM-DD, with no zone involved.
 *
 * Every date here is read as UTC midnight, which is not a claim about where the
 * date came from: it is how two zoneless dates are compared and how days are
 * counted between them without a host's local zone changing the answer twice a
 * year.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** True only for a real calendar date. `2026-02-30` is not one. */
export const isIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** b minus a, in whole days. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The day of the week of a calendar date, 0 for Sunday to 6 for Saturday, the same in every zone. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
