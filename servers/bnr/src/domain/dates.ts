import { isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/** The calendar date in `timeZone` at `epochMs`, YYYY-MM-DD. Pure. */
export const dateIn = (timeZone: string, epochMs: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochMs));

/** BNR's XML series start in 2005. */
export const FIRST_YEAR = 2005;

export const checkedDate = (date: string, today: string): string => {
  const d = date.trim();
  if (!isIsoDate(d)) fail(inputError(`date must be a calendar date, YYYY-MM-DD, not "${date}"`));
  if (d > today) fail(inputError(`${d} is after today (${today} in Bucharest); BNR has published no rate for it`));
  if (Number(d.slice(0, 4)) < FIRST_YEAR) fail(inputError(`BNR's XML series start in ${FIRST_YEAR}`));
  return d;
};
