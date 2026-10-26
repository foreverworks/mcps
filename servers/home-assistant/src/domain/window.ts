import { fail, inputError } from "./errors.js";

/**
 * The window history and logbook read: from `start` to `end`, or the last
 * `hours` up to now. Times carry their offset (2026-03-01T18:00:00+02:00 or
 * ...Z), so the window is exact whatever zone the server runs in. Pure.
 */

export const DEFAULT_HOURS = 24;
/** The recorder keeps 10 days by default; a longer window is for an instance that keeps more. */
export const MAX_DAYS = 31;

export type WindowArgs = {
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly hours?: number | undefined;
};

export type Window = { readonly start: string; readonly end: string };

const HOUR_MS = 3_600_000;

const instant = (text: string, what: string): number => {
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? fail(inputError(`${what} "${text}" is not a date and time`)) : ms;
};

export const windowOf = (a: WindowArgs, now: number): Window => {
  if (a.hours !== undefined && a.start !== undefined) fail(inputError("give either hours or start, not both"));
  const end = a.end === undefined ? now : instant(a.end, "end");
  const start = a.start === undefined ? end - (a.hours ?? DEFAULT_HOURS) * HOUR_MS : instant(a.start, "start");
  if (start >= end) fail(inputError("the window must start before it ends"));
  if (start > now) fail(inputError("the window starts in the future"));
  if (end - start > MAX_DAYS * 24 * HOUR_MS) fail(inputError(`the window is longer than ${MAX_DAYS} days; ask for a shorter one`));
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
};

/** The newest `limit` items of a list in time order, and how many earlier ones were left out. */
export const newest = <T>(items: readonly T[], limit: number): { readonly kept: readonly T[]; readonly omitted: number } =>
  items.length <= limit ? { kept: items, omitted: 0 } : { kept: items.slice(items.length - limit), omitted: items.length - limit };
