import { addDays, weekdayOf } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import { assertTimeZone, type Interval, localClock, localMinutesToEpoch, mergeIntervals, parseClockTime, subtractIntervals } from "./time.js";

/**
 * Where a meeting of a given length fits: the slot arithmetic behind
 * find_time. Pure: the busy timeline, the window and "now" all arrive as
 * arguments, so every rule here is tested without a calendar or a clock.
 *
 * Working hours are WALL-CLOCK hours in a named zone, turned into instants one
 * local day at a time. That is what keeps 09:00 at 09:00 across a DST change:
 * in Bucharest, 09:00 is 06:00Z in summer and 07:00Z in winter, and the day of
 * the change itself is 23 or 25 hours long.
 */

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type WorkingHours = {
  readonly days: readonly Weekday[];
  /** HH:MM, local. */
  readonly start: string;
  /** HH:MM, local, exclusive; "24:00" is the end of the day. Must come after `start`: no overnight shifts. */
  readonly end: string;
  readonly timeZone: string;
};

export type Preference = "earliest" | "morning" | "afternoon";

export type SlotRequest = {
  readonly window: Interval;
  readonly nowMs: number;
  readonly durationMinutes: number;
  /** Slots start on this grid, counted from the start of working hours: 30 means :00 and :30. */
  readonly stepMinutes: number;
  /** No slot starts sooner than this after now. */
  readonly minNoticeMinutes: number;
  /** Free time kept before an existing event: a slot ends at least this long before one starts. */
  readonly bufferBeforeMinutes: number;
  /** Free time kept after an existing event: a slot starts at least this long after one ends. */
  readonly bufferAfterMinutes: number;
  readonly hours: WorkingHours;
  /** Earliest first, or the preferred half of the day (before or after 12:00 local) first, each in time order. */
  readonly prefer: Preference;
  readonly limit: number;
};

export type SlotResult = {
  /** In rank order; overlapping candidates on the step grid, so 09:00 and 09:30 are two answers for a one-hour meeting. */
  readonly slots: readonly Interval[];
  /** How many more slots there were beyond `limit`. */
  readonly more: number;
  /** The free stretches that hold at least one slot, in time order: the compact form of the same answer. */
  readonly ranges: readonly Interval[];
};

const MINUTE = 60_000;
const NOON = 12 * 60;

/** Working hours as minutes after local midnight, or a clean input failure naming what is wrong. */
const parseHours = (hours: WorkingHours): { readonly open: number; readonly close: number } => {
  assertTimeZone(hours.timeZone);
  const open = parseClockTime(hours.start, "working hours start");
  const close = parseClockTime(hours.end, "working hours end");
  if (close <= open) return fail(inputError(`working hours must end after they start (got ${hours.start}-${hours.end}); overnight hours are not supported`));
  if (hours.days.length === 0) return fail(inputError("working days is empty, so no time can be offered"));
  return { open, close };
};

/** One working day's hours as instants, and where its local noon falls (morning is before it). */
export type Stretch = Interval & { readonly noonMs: number };

/**
 * Every working-hours stretch that touches the window, one per working day,
 * unclipped: the grid is counted from each stretch's true start, so a window
 * that opens at 10:07 still offers 10:30, not 10:37.
 */
export const workingStretches = (window: Interval, hours: WorkingHours): readonly Stretch[] => {
  const { open, close } = parseHours(hours);
  // One day either side: a stretch in a zone far from UTC can begin on the day before the window's first local date.
  const first = addDays(localClock(window.startMs, hours.timeZone).date, -1);
  const last = addDays(localClock(window.endMs, hours.timeZone).date, 1);
  const stretches: Stretch[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (!hours.days.includes(WEEKDAYS[weekdayOf(date)] as Weekday)) continue;
    const startMs = localMinutesToEpoch(date, open, hours.timeZone);
    const endMs = localMinutesToEpoch(date, close, hours.timeZone);
    if (endMs > window.startMs && startMs < window.endMs) stretches.push({ startMs, endMs, noonMs: localMinutesToEpoch(date, NOON, hours.timeZone) });
  }
  return stretches;
};

/** Every busy block widened by the buffers, then merged: two meetings 10 minutes apart with 15-minute buffers are one block. */
const widen = (busy: readonly Interval[], beforeMs: number, afterMs: number): readonly Interval[] =>
  mergeIntervals(busy.map((b) => ({ startMs: b.startMs - beforeMs, endMs: b.endMs + afterMs })));

/**
 * Every argument checked, before anything is read: a request that cannot be
 * answered fails as input, with nothing sent to Google.
 */
export const validateSlotRequest = (r: SlotRequest): void => {
  parseHours(r.hours);
  if (!(r.window.endMs > r.window.startMs)) fail(inputError("the window is empty: `to` must come after `from`"));
  if (!(Number.isInteger(r.durationMinutes) && r.durationMinutes > 0)) fail(inputError("duration_minutes must be a positive whole number"));
  if (!(Number.isInteger(r.stepMinutes) && r.stepMinutes > 0)) fail(inputError("step_minutes must be a positive whole number"));
  for (const [value, what] of [
    [r.minNoticeMinutes, "min_notice_minutes"],
    [r.bufferBeforeMinutes, "buffer_before_minutes"],
    [r.bufferAfterMinutes, "buffer_after_minutes"],
  ] as const) {
    if (!(value >= 0)) fail(inputError(`${what} cannot be negative`));
  }
  if (!(Number.isInteger(r.limit) && r.limit > 0)) fail(inputError("max_results must be a positive whole number"));
};

/**
 * Slots of `durationMinutes` inside working hours, inside the window, after
 * the notice, clear of every busy block and its buffers, on the step grid.
 * `busy` may be unsorted and overlapping; it is merged here.
 */
export const findSlots = (busy: readonly Interval[], r: SlotRequest): SlotResult => {
  validateSlotRequest(r);
  const duration = r.durationMinutes * MINUTE;
  const step = r.stepMinutes * MINUTE;
  const blocked = widen(busy, r.bufferBeforeMinutes * MINUTE, r.bufferAfterMinutes * MINUTE);
  const earliest = Math.max(r.window.startMs, r.nowMs + r.minNoticeMinutes * MINUTE);

  const candidates: (Interval & { readonly preferred: boolean })[] = [];
  const ranges: Interval[] = [];
  const preferred = (at: number, stretch: Stretch): boolean =>
    r.prefer === "earliest" || (r.prefer === "morning" ? at < stretch.noonMs : at >= stretch.noonMs);
  for (const stretch of workingStretches(r.window, r.hours)) {
    const usable = { startMs: Math.max(stretch.startMs, earliest), endMs: Math.min(stretch.endMs, r.window.endMs) };
    if (usable.endMs <= usable.startMs) continue;
    for (const free of subtractIntervals(usable, blocked)) {
      // The first grid point at or after the free part's start, counted from the stretch's own start.
      let at = stretch.startMs + Math.ceil((free.startMs - stretch.startMs) / step) * step;
      const before = candidates.length;
      for (; at + duration <= free.endMs; at += step) candidates.push({ startMs: at, endMs: at + duration, preferred: preferred(at, stretch) });
      if (candidates.length > before) ranges.push(free);
    }
  }

  // Stable: each group keeps time order, and the preferred group goes first.
  const ranked = [...candidates.filter((c) => c.preferred), ...candidates.filter((c) => !c.preferred)];
  return {
    slots: ranked.slice(0, r.limit).map(({ startMs, endMs }) => ({ startMs, endMs })),
    more: Math.max(0, ranked.length - r.limit),
    ranges,
  };
};
