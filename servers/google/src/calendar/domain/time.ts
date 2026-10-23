import { addDays, isIsoDate } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * Wall-clock time in a named zone, and the instants it means. Pure: Intl is the
 * only thing consulted, and it is deterministic for a given zone database.
 *
 * Why this exists at all: a person says "tomorrow at 10" and means their own
 * zone, while the Calendar API wants an instant. A time without an offset is
 * read in the server's zone (CALENDAR_TIME_ZONE, else the process's), which a
 * deployment on a UTC host sets to its users' zone.
 */

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** "+03:00" for Bucharest in summer. */
export const offsetAt = (timeZone: string, epochMs: number): string => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date(epochMs))
    .find((p) => p.type === "timeZoneName")?.value;
  // Intl says "GMT" for UTC itself, and "GMT+03:00" everywhere else.
  const m = /^GMT([+-]\d{2}:\d{2})?$/.exec(name ?? "");
  if (!m) return fail(inputError(`cannot read the UTC offset of time zone "${timeZone}"`));
  return m[1] ?? "+00:00";
};

const offsetMs = (offset: string): number => {
  const sign = offset.startsWith("-") ? -1 : 1;
  const [h, m] = offset.slice(1).split(":").map(Number);
  return sign * ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
};

/**
 * A wall-clock time in `timeZone`, as RFC 3339 with its offset.
 *
 * Two passes, because the offset depends on the instant and the instant on the
 * offset: guess with the offset at that wall time read as UTC, then correct
 * with the offset at the instant the guess produced. That is exact everywhere
 * except inside the hour a DST change skips or repeats, which no one books.
 */
export const zonedToInstant = (date: string, time: string, timeZone: string): string => {
  const asUtc = Date.parse(`${date}T${time}Z`);
  const first = offsetAt(timeZone, asUtc);
  const second = offsetAt(timeZone, asUtc - offsetMs(first));
  return `${date}T${time}${second}`;
};

/** One end of an event: a whole day, or an instant. */
export type When = { readonly kind: "date"; readonly date: string } | { readonly kind: "dateTime"; readonly dateTime: string };

/**
 * What a caller may pass for a time: `2026-09-29` (a whole day),
 * `2026-09-29T10:00` (wall clock in the server's zone), or RFC 3339 with its
 * own offset or Z, which is taken as given.
 */
export const parseWhen = (input: string, timeZone: string): When => {
  const value = input.trim();
  if (isIsoDate(value)) return { kind: "date", date: value };
  if (WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value))) return { kind: "dateTime", dateTime: value };
  const m = LOCAL.exec(value);
  if (m && isIsoDate(m[1] as string) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4] ?? 0) < 60) {
    return { kind: "dateTime", dateTime: zonedToInstant(m[1] as string, `${m[2]}:${m[3]}:${m[4] ?? "00"}`, timeZone) };
  }
  return fail(inputError(`"${input}" is not a time; use YYYY-MM-DD, YYYY-MM-DDTHH:MM (read in ${timeZone}), or RFC 3339 with an offset`));
};

/** A date or a time, as the instant a window starts at: a whole day starts at its local midnight. */
export const windowBound = (input: string, timeZone: string): string => {
  const when = parseWhen(input, timeZone);
  return when.kind === "date" ? zonedToInstant(when.date, "00:00:00", timeZone) : when.dateTime;
};

/** Today's date in `timeZone`, for a default window. */
export const todayIn = (timeZone: string, nowMs: number): string => localClock(nowMs, timeZone).date;

/** Epoch ms of an event end. A whole day is read at its local midnight in `timeZone`. */
export const epochOf = (when: When, timeZone: string): number =>
  Date.parse(when.kind === "date" ? zonedToInstant(when.date, "00:00:00", timeZone) : when.dateTime);

/**
 * A zone name Intl knows, or a clean input failure. Intl throws a RangeError
 * for an unknown zone, which would otherwise surface as an unexpected bug
 * rather than as the caller's typo.
 */
export const assertTimeZone = (timeZone: string): string => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return fail(inputError(`"${timeZone}" is not an IANA time zone (e.g. Europe/Bucharest)`));
  }
};

/** An instant as RFC 3339 written in a given offset ("+03:00"). */
export const formatWithOffset = (epochMs: number, offset: string): string =>
  `${new Date(epochMs + offsetMs(offset)).toISOString().slice(0, 19)}${offset}`;

/** The offset an RFC 3339 string is written in; "Z" and a string without one read as "+00:00". */
export const offsetOfText = (rfc3339: string): string => {
  const m = /([+-]\d{2}:\d{2})$/.exec(rfc3339);
  return m?.[1] ?? "+00:00";
};

/** An instant as RFC 3339 in `timeZone`'s offset at that instant: what the user reads. */
export const instantIn = (epochMs: number, timeZone: string): string => formatWithOffset(epochMs, offsetAt(timeZone, epochMs));

/** The local date and the minutes since local midnight of an instant in `timeZone`. */
export const localClock = (epochMs: number, timeZone: string): { readonly date: string; readonly minutes: number } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
};

/**
 * The window a read covers, from what the caller gave: `from` (a date or a
 * time; empty means today in `timeZone`), and either an exclusive `to` or a
 * number of `days`, never longer than `maxDays`. A whole day starts at its
 * local midnight, so "7 days from 2026-10-22" ends at local midnight on the
 * 29th across the October DST change.
 */
export const windowOf = (
  request: { readonly from: string; readonly to: string; readonly days: number },
  timeZone: string,
  nowMs: number,
  maxDays: number,
): { readonly timeMin: string; readonly timeMax: string } => {
  if (!(request.days > 0 && request.days <= maxDays)) return fail(inputError(`days must be between 1 and ${maxDays}`));
  const from = request.from.trim() || todayIn(timeZone, nowMs);
  const timeMin = windowBound(from, timeZone);
  const timeMax = request.to.trim()
    ? windowBound(request.to, timeZone)
    : windowBound(isIsoDate(from) ? addDays(from, request.days) : new Date(Date.parse(timeMin) + request.days * 86_400_000).toISOString(), timeZone);
  if (Date.parse(timeMax) <= Date.parse(timeMin)) return fail(inputError("`to` must come after `from`"));
  // An hour of slack for a window that crosses the October change, which is an hour longer than its days.
  if (Date.parse(timeMax) - Date.parse(timeMin) > maxDays * 86_400_000 + 3_600_000) {
    return fail(inputError(`the window is longer than ${maxDays} days; split it`));
  }
  return { timeMin, timeMax };
};

/**
 * A wall-clock time of day, "HH:MM", as minutes after local midnight. "24:00"
 * is allowed and means the end of the day, so working hours can run to midnight.
 */
export const parseClockTime = (hhmm: string, what: string): number => {
  const m = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(hhmm.trim());
  const minutes = m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
  if (!m || minutes > 24 * 60) return fail(inputError(`${what} "${hhmm}" is not a time of day; use HH:MM, 00:00 to 24:00`));
  return minutes;
};

/** A date plus minutes after its local midnight, as epoch ms in `timeZone`. 1440 is the next day's midnight. */
export const localMinutesToEpoch = (date: string, minutes: number, timeZone: string): number => {
  const day = addDays(date, Math.floor(minutes / 1440));
  const rest = minutes % 1440;
  const clock = `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}:00`;
  return Date.parse(zonedToInstant(day, clock, timeZone));
};

// ---- intervals ----------------------------------------------------------------------------------

/** A stretch of time, start inclusive and end exclusive, in epoch ms. */
export type Interval = { readonly startMs: number; readonly endMs: number };

/**
 * Sorted, with overlapping and touching intervals joined into one. `join`
 * combines what else two joined intervals carry (a flag, say); by default the
 * earlier one's fields are kept over the joined span. The argument is not changed.
 */
export const mergeIntervals = <T extends Interval>(
  intervals: readonly T[],
  join: (a: T, b: T, span: Interval) => T = (a, _b, span) => ({ ...a, ...span }),
): readonly T[] => {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: T[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last && next.startMs <= last.endMs) {
      merged[merged.length - 1] = join(last, next, { startMs: last.startMs, endMs: Math.max(last.endMs, next.endMs) });
    } else {
      merged.push(next);
    }
  }
  return merged;
};

/** The part of each interval inside the window; intervals wholly outside it are gone. */
export const clip = <T extends Interval>(intervals: readonly T[], window: Interval): readonly T[] =>
  intervals.flatMap((i) => {
    const startMs = Math.max(i.startMs, window.startMs);
    const endMs = Math.min(i.endMs, window.endMs);
    return endMs > startMs ? [{ ...i, startMs, endMs }] : [];
  });

/** What is left of `from` once every interval in `taken` (sorted, as mergeIntervals leaves them) is removed, in time order. */
export const subtractIntervals = (from: Interval, taken: readonly Interval[]): readonly Interval[] => {
  const free: Interval[] = [];
  let cursor = from.startMs;
  for (const t of taken) {
    if (t.endMs <= cursor) continue;
    if (t.startMs >= from.endMs) break;
    if (t.startMs > cursor) free.push({ startMs: cursor, endMs: t.startMs });
    cursor = Math.max(cursor, t.endMs);
  }
  if (cursor < from.endMs) free.push({ startMs: cursor, endMs: from.endMs });
  return free;
};
