import { addDays, isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * Days as eToll counts them: in Bucharest, whatever the host's zone is. A
 * vignette is valid until a calendar day there, an invoice window is a pair
 * of days there, and "days left" is counted between two such days. Pure.
 *
 * Built on Intl because Node 22 has no Temporal; Temporal.ZonedDateTime
 * would replace dayStart and bucharestStamp.
 */

export const ZONE = "Europe/Bucharest";

/** The default invoice window: the last year up to today. */
export const DEFAULT_DAYS = 365;

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const fieldsAt = (epochMs: number): Readonly<Record<string, number>> =>
  Object.fromEntries(wallClock.formatToParts(new Date(epochMs)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));

const pad = (n: number | undefined, width = 2): string => String(n ?? 0).padStart(width, "0");

/** The calendar date in Bucharest at an instant. */
export const bucharestDate = (epochMs: number): string => {
  const f = fieldsAt(epochMs);
  return `${pad(f["year"], 4)}-${pad(f["month"])}-${pad(f["day"])}`;
};

/** Today in Bucharest, from a clock in epoch seconds. */
export const bucharestToday = (nowEpoch: number): string => bucharestDate(nowEpoch * 1000);

/** How far Bucharest's wall clock is ahead of UTC at an instant, in ms: two hours in winter, three in summer. */
const offsetAt = (epochMs: number): number => {
  const f = fieldsAt(epochMs);
  const wall = Date.UTC(f["year"] ?? 0, (f["month"] ?? 1) - 1, f["day"] ?? 1, f["hour"] ?? 0, f["minute"] ?? 0, f["second"] ?? 0);
  return wall - Math.floor(epochMs / 1000) * 1000;
};

/**
 * The instant a Bucharest day starts. Read once with the offset at UTC
 * midnight, then again with the offset at that first answer, so a day whose
 * offset changes overnight (the DST Sundays) still lands on its own midnight.
 */
const dayStart = (date: string): number => {
  const asUtc = Date.parse(`${date}T00:00:00Z`);
  return asUtc - offsetAt(asUtc - offsetAt(asUtc));
};

/** An instant as Bucharest's wall clock with its offset, the way the portal formats one (`yyyy-MM-ddTHH:mm:ss.fffK`). */
export const bucharestStamp = (epochMs: number): string => {
  const f = fieldsAt(epochMs);
  const offsetMin = Math.round(offsetAt(epochMs) / 60_000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const ms = pad(((epochMs % 1000) + 1000) % 1000, 3);
  return `${pad(f["year"], 4)}-${pad(f["month"])}-${pad(f["day"])}T${pad(f["hour"])}:${pad(f["minute"])}:${pad(f["second"])}.${ms}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** The first instant of a Bucharest day, stamped with its offset: what eToll takes as a vignette's start. */
export const dayStartStamp = (date: string): string => bucharestStamp(dayStart(date));

export type Window = { readonly from: string; readonly to: string };

export const windowOf = (from: string | undefined, to: string | undefined, nowMs: number): Window => {
  const today = bucharestDate(nowMs);
  const end = to ?? today;
  const start = from ?? addDays(end, -DEFAULT_DAYS);
  if (start > end) fail(inputError(`from (${start}) is after to (${end})`));
  return { from: start, to: end };
};

/** The window's edges as GET invoices takes them: the first instant of `from` and the last of `to`, on Bucharest's clock with its offset. */
export const edges = (w: Window): Window => ({
  from: bucharestStamp(dayStart(w.from)),
  to: bucharestStamp(dayStart(addDays(w.to, 1)) - 1),
});

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * The Bucharest calendar date of a moment eToll sent: an instant when it
 * carries a zone (`Z`, `+02:00`), else a wall-clock time that is already
 * Bucharest's (the portal's own DateTime values carry none). Undefined for
 * anything that is not a date.
 */
export const localDateOf = (wire: string | null | undefined): string | undefined => {
  if (typeof wire !== "string") return undefined;
  const s = wire.trim();
  if (ZONED.test(s)) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? undefined : bucharestDate(ms);
  }
  const day = s.slice(0, 10);
  return isIsoDate(day) ? day : undefined;
};
