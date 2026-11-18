import { addDays, isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * The portal's calendar is Bucharest's: its screens send days as YYYY-MM-DD
 * and an appointment's "now" as the browser's local "YYYY-MM-DD HH:mm". Pure.
 */
export const ZONE = "Europe/Bucharest";

const parts = (epochMs: number) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(epochMs)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

export const todayIn = (epochMs: number): string => {
  const p = parts(epochMs);
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
};

/** Now as the portal's appointment filters write it. */
export const localMinute = (epochMs: number): string => {
  const p = parts(epochMs);
  return `${todayIn(epochMs)} ${p["hour"]}:${p["minute"]}`;
};

/**
 * A window of days: what was asked, with `to` defaulting to today and `from`
 * to `defaultDays` before it. A day that is not one, or a window that runs
 * backwards, is refused before anything is asked of the portal.
 */
export const windowOf = (from: string | undefined, to: string | undefined, epochMs: number, defaultDays: number): { readonly from: string; readonly to: string } => {
  for (const [name, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (value !== undefined && !isIsoDate(value)) return fail(inputError(`${name} must be a day, YYYY-MM-DD; "${value}" is not one`));
  }
  const end = to ?? todayIn(epochMs);
  const start = from ?? addDays(end, -defaultDays);
  return start > end ? fail(inputError(`the window runs backwards: from ${start} is after to ${end}`)) : { from: start, to: end };
};
