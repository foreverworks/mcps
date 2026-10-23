/**
 * SPV prints every time as Bucharest wall-clock time, `dd.mm.yyyy hh:mm:ss`,
 * with no zone. ANAF is a Romanian authority, so the zone is the country's
 * whatever the host's is. This module turns those strings into instants and
 * ISO 8601 text with the offset that applied, and back to calendar dates. Pure.
 */

export const ZONE = "Europe/Bucharest";

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

/** How far Bucharest's wall clock is ahead of UTC at an instant, in ms: two hours in winter, three in summer. */
const offsetAt = (epochMs: number): number => {
  const f = fieldsAt(epochMs);
  const wall = Date.UTC(f["year"] ?? 0, (f["month"] ?? 1) - 1, f["day"] ?? 1, f["hour"] ?? 0, f["minute"] ?? 0, f["second"] ?? 0);
  return wall - Math.floor(epochMs / 1000) * 1000;
};

const offsetText = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** An instant as Bucharest wall time with its offset: `2026-07-15T10:00:00+03:00`. */
export const isoAt = (epochMs: number): string => {
  const f = fieldsAt(epochMs);
  return `${pad(f["year"], 4)}-${pad(f["month"])}-${pad(f["day"])}T${pad(f["hour"])}:${pad(f["minute"])}:${pad(f["second"])}${offsetText(offsetAt(epochMs))}`;
};

/** The calendar date in Bucharest at an instant. */
export const dateAt = (epochMs: number): string => isoAt(epochMs).slice(0, 10);

const PORTAL_TIME = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * The instant SPV meant by `15.07.2026 10:00:00` (seconds and the time itself
 * optional). Read once with the offset at the wall time taken as UTC, then
 * again with the offset at that first answer, so a time beside a DST change
 * lands on the right side of it. `undefined` for anything else.
 */
export const portalInstant = (text: string): number | undefined => {
  const m = PORTAL_TIME.exec(text.trim());
  if (m === null) return undefined;
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
  const asUtc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  const check = new Date(asUtc);
  if (check.getUTCDate() !== Number(dd) || check.getUTCMonth() !== Number(mm) - 1) return undefined;
  return asUtc - offsetAt(asUtc - offsetAt(asUtc));
};

/** The instant a Bucharest calendar date (`YYYY-MM-DD`) starts. */
export const dayStart = (date: string): number => {
  const asUtc = Date.parse(`${date}T00:00:00Z`);
  return asUtc - offsetAt(asUtc - offsetAt(asUtc));
};
