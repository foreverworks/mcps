import { isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * A date as an agent writes one: `YYYY-MM-DD`, an ISO 8601 date-time with an
 * offset (`2026-09-28T14:30:00+03:00`), or `{start, end, time_zone}` for a
 * range or a wall-clock time in a named zone. Checked here so that a typo is a
 * refusal that names the column, not Notion's generic validation error. Used
 * by the writes (properties/write.ts) and the filters (query/filter.ts).
 */

export type DateInput = { readonly start: string; readonly end?: string; readonly timeZone?: string };

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

export const isDateText = (value: string): boolean =>
  isIsoDate(value) || (DATE_TIME.test(value) && !Number.isNaN(Date.parse(value.length === 16 ? `${value}:00` : value)));

const one = (value: unknown, what: string): string => {
  if (typeof value === "string" && isDateText(value.trim())) return value.trim();
  return fail(inputError(`${what} takes YYYY-MM-DD or an ISO date-time, not ${JSON.stringify(value)}`));
};

export const parseDate = (value: unknown, what: string): DateInput => {
  if (typeof value === "string") return { start: one(value, what) };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { start, end, time_zone } = value as { start?: unknown; end?: unknown; time_zone?: unknown };
    const range: DateInput = {
      start: one(start, `${what} start`),
      ...(end === undefined || end === null ? {} : { end: one(end, `${what} end`) }),
      ...(typeof time_zone === "string" && time_zone.trim() !== "" ? { timeZone: time_zone.trim() } : {}),
    };
    if (range.end !== undefined && range.end < range.start && range.end.length === range.start.length) {
      return fail(inputError(`${what} ends (${range.end}) before it starts (${range.start})`));
    }
    return range;
  }
  return fail(inputError(`${what} takes YYYY-MM-DD, an ISO date-time or {start, end, time_zone}, not ${JSON.stringify(value)}`));
};
