import { addDays, isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * The date window the portal's lists take. Its own screens send ISO instants
 * at the edges of the Bucharest day (a date picker's local midnight, in UTC);
 * this server takes calendar dates and does the same. ONRC is a Romanian
 * authority, so the zone is the country's whatever the host's is. Pure.
 */
export type Window = { readonly from: string; readonly to: string };

/** The zone ONRC's days are counted in. */
export const ZONE = "Europe/Bucharest";

/** The default window: the last `days` days up to today. The portal's own screens default to 30. */
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

/** How far Bucharest's wall clock is ahead of UTC at an instant: two hours in winter, three in summer. */
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

export const windowOf = (from: string | undefined, to: string | undefined, nowMs: number): Window => {
  const today = bucharestDate(nowMs);
  const end = to ?? today;
  const start = from ?? addDays(today, -DEFAULT_DAYS);
  for (const d of [start, end]) if (!isIsoDate(d)) fail(inputError(`"${d}" is not a date (YYYY-MM-DD)`));
  if (start > end) fail(inputError(`from (${start}) is after to (${end})`));
  return { from: start, to: end };
};

/** The window's edges as the portal wants them: the first instant of `from` and the last of `to` in Bucharest, as UTC instants. */
export const edges = (w: Window): { readonly from: string; readonly to: string } => ({
  from: new Date(dayStart(w.from)).toISOString(),
  to: new Date(dayStart(addDays(w.to, 1)) - 1).toISOString(),
});
