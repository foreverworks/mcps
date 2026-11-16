import { isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/** The calendar date in `timeZone` at `epochMs`, YYYY-MM-DD. Pure. */
export const dateIn = (timeZone: string, epochMs: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochMs));

/** The first day the ECB published reference rates, the euro's first working day. */
export const FIRST_FIXING = "1999-01-04";

/** A date the ECB can have a rate for: a real calendar day, not after `today`, not before the series began. */
export const checkedDate = (date: string, today: string): string => {
  const d = date.trim();
  if (!isIsoDate(d)) fail(inputError(`date must be a calendar date, YYYY-MM-DD, not "${date}"`));
  if (d > today) fail(inputError(`${d} is after today (${today} in Frankfurt); the ECB has published no rate for it`));
  if (d < FIRST_FIXING) fail(inputError(`the ECB's reference rates start on ${FIRST_FIXING}`));
  return d;
};
