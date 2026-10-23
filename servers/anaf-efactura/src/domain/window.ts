import { fail, inputError } from "./errors.js";

/** ANAF refuses a lookback longer than this, on every listing endpoint. */
export const MAX_DAYS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const parseIsoDate = (name: string, value: string): number => {
  if (!ISO_DATE.test(value)) fail(inputError(`${name} must be YYYY-MM-DD, got "${value}"`));
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) fail(inputError(`${name} is not a real date: "${value}"`));
  return ms;
};

export const parseDays = (zile: number): number => {
  if (!Number.isInteger(zile) || zile < 1 || zile > MAX_DAYS)
    fail(inputError(`zile must be a whole number between 1 and ${MAX_DAYS} (ANAF's limit), got ${zile}`));
  return zile;
};

export type MsWindow = { readonly startTimeMs: number; readonly endTimeMs: number };

/**
 * An inclusive YYYY-MM-DD range as the millisecond bounds the paginated
 * endpoint wants.
 *
 * Both ends are read as UTC. The Python this replaces used the host's local
 * zone, which silently moved the boundary by an hour twice a year and made the
 * same arguments return different result sets on different boxes.
 */
export const parseWindow = (startDate: string, endDate: string): MsWindow => {
  const startTimeMs = parseIsoDate("start_date", startDate);
  const endExclusiveMs = parseIsoDate("end_date", endDate) + DAY_MS;
  if (endExclusiveMs <= startTimeMs) fail(inputError(`start_date ${startDate} is after end_date ${endDate}`));
  if (endExclusiveMs - startTimeMs > MAX_DAYS * DAY_MS)
    fail(inputError(`the window spans more than ${MAX_DAYS} days (ANAF's limit); split it`));
  return { startTimeMs, endTimeMs: endExclusiveMs };
};

/**
 * ANAF's message-type filter. `R` is the odd one: it means "needs a response",
 * not "received", and mixing the two up is a silent empty result.
 */
export const FILTERS = {
  E: "errors",
  T: "sent",
  P: "received",
  R: "awaiting a response",
} as const;

export type Filter = keyof typeof FILTERS;

export const parseFilter = (value: string): Filter | undefined => {
  if (value === "") return undefined;
  const upper = value.toUpperCase();
  if (!(upper in FILTERS)) fail(inputError(`filtru must be one of ${Object.keys(FILTERS).join(", ")} or empty`));
  return upper as Filter;
};
