import { type Busy, mergeBusy } from "../../domain/busy.js";
import { fail, inputError } from "../../domain/errors.js";
import { findSlots, type Preference, type SlotRequest, validateSlotRequest, type Weekday } from "../../domain/slots.js";
import { assertTimeZone, clip, instantIn, type Interval, windowOf } from "../../domain/time.js";
import type { Deps } from "../ports.js";
import { gatherBusy, type Gathered, MAX_BUSY_DAYS } from "./busy.js";
import type { CalendarChoice } from "./fetch.js";

/**
 * free_busy and find_time: when the user (and anyone else asked about) is
 * busy, and where a meeting fits. The gathering is in busy.ts, the rules in
 * domain/busy.ts and domain/slots.ts; this file turns instants into the times
 * the user reads, in one zone, with their offsets.
 */

export type BusyRequest = {
  /** YYYY-MM-DD or a time; empty means today. */
  readonly from: string;
  /** Exclusive. Empty means `days` after `from`. */
  readonly to: string;
  readonly days: number;
  readonly calendars: CalendarChoice;
  readonly attendees: readonly string[];
};

const firstOf = (accounts: readonly Deps[]): Deps => accounts[0] ?? fail(inputError("no account to read"));

const shown = (b: Interval & { readonly tentative?: boolean; readonly allDay?: boolean }, timeZone: string) => ({
  start: instantIn(b.startMs, timeZone),
  end: instantIn(b.endMs, timeZone),
  ...(b.tentative ? { tentative: true } : {}),
  ...(b.allDay ? { allDay: true } : {}),
});

/** What is missing from the answer, or nothing when it is whole. */
const completeness = (gathered: Gathered) =>
  gathered.unknown.length === 0 ? { complete: true } : { complete: false, unknown: gathered.unknown };

/**
 * Busy blocks per calendar and per attendee, and ONE merged timeline of all of
 * them, each clipped to the window. The merged timeline is when a meeting with
 * everyone asked about cannot happen: the same meeting on both accounts counts
 * once, and back-to-back blocks join.
 */
export const freeBusy = async (accounts: readonly Deps[], request: BusyRequest) => {
  const first = firstOf(accounts);
  const timeZone = first.timeZone;
  const span = windowOf(request, timeZone, first.now(), MAX_BUSY_DAYS);
  const window = { startMs: Date.parse(span.timeMin), endMs: Date.parse(span.timeMax) };
  const gathered = await gatherBusy(accounts, span, request, timeZone);

  const everyone: readonly Busy[] = [
    ...gathered.calendars.flatMap((c) => c.blocks),
    ...gathered.attendees.flatMap((a) => (a.kind === "known" ? a.blocks : [])),
  ];
  return {
    timeZone,
    from: span.timeMin,
    to: span.timeMax,
    accounts: accounts.map((d) => d.account),
    busy: mergeBusy(clip(everyone, window)).map((b) => shown(b, timeZone)),
    calendars: gathered.calendars.map((c) => ({
      account: c.account,
      calendarId: c.calendarId,
      calendar: c.calendar,
      busy: clip(c.blocks, window).map((b) => shown(b, timeZone)),
    })),
    ...(gathered.attendees.length
      ? {
          attendees: gathered.attendees.map((a) =>
            a.kind === "known"
              ? { email: a.email, seenBy: a.seenBy, busy: clip(a.blocks, window).map((b) => shown(b, timeZone)) }
              : { email: a.email, unknown: true, reasons: a.reasons },
          ),
        }
      : {}),
    ...completeness(gathered),
  };
};

export type FindTimeRequest = BusyRequest & {
  readonly durationMinutes: number;
  readonly stepMinutes: number;
  readonly minNoticeMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly workingDays: readonly Weekday[];
  readonly hoursStart: string;
  readonly hoursEnd: string;
  /** Empty means the server's zone. Also the zone `from` and `to` are read in, and the answer is written in. */
  readonly timeZone: string;
  readonly prefer: Preference;
  readonly limit: number;
  /** Offer slots over tentative blocks. Off by default: a "maybe" is still a promise to someone. */
  readonly tentativeIsFree: boolean;
};

/**
 * Candidate slots for a meeting across every account (and the attendees),
 * honouring working hours, the notice, the buffers and the preference.
 *
 * Events are read a little beyond the window, by the buffers: a meeting that
 * ends at 08:55 still casts its 15-minute buffer over a window opening at 09:00.
 */
export const findTime = async (accounts: readonly Deps[], request: FindTimeRequest) => {
  const first = firstOf(accounts);
  const timeZone = assertTimeZone(request.timeZone.trim() || first.timeZone);
  const span = windowOf(request, timeZone, first.now(), MAX_BUSY_DAYS);
  const window = { startMs: Date.parse(span.timeMin), endMs: Date.parse(span.timeMax) };
  const reach = {
    timeMin: new Date(window.startMs - request.bufferAfterMinutes * 60_000).toISOString(),
    timeMax: new Date(window.endMs + request.bufferBeforeMinutes * 60_000).toISOString(),
  };
  const slotRequest: SlotRequest = {
    window,
    nowMs: first.now(),
    durationMinutes: request.durationMinutes,
    stepMinutes: request.stepMinutes,
    minNoticeMinutes: request.minNoticeMinutes,
    bufferBeforeMinutes: request.bufferBeforeMinutes,
    bufferAfterMinutes: request.bufferAfterMinutes,
    hours: { days: request.workingDays, start: request.hoursStart, end: request.hoursEnd, timeZone },
    prefer: request.prefer,
    limit: request.limit,
  };
  validateSlotRequest(slotRequest);
  const gathered = await gatherBusy(accounts, reach, request, first.timeZone);

  const busy: readonly Busy[] = [
    ...gathered.calendars.flatMap((c) => c.blocks).filter((b) => !(request.tentativeIsFree && b.tentative)),
    ...gathered.attendees.flatMap((a) => (a.kind === "known" ? a.blocks : [])),
  ];
  const result = findSlots(busy, slotRequest);
  const whole = completeness(gathered);
  return {
    timeZone,
    from: span.timeMin,
    to: span.timeMax,
    accounts: accounts.map((d) => d.account),
    durationMinutes: request.durationMinutes,
    workingHours: { days: request.workingDays, start: request.hoursStart, end: request.hoursEnd },
    slots: result.slots.map((s) => shown(s, timeZone)),
    ...(result.more > 0 ? { more: result.more } : {}),
    ranges: result.ranges.map((r) => ({ ...shown(r, timeZone), minutes: Math.round((r.endMs - r.startMs) / 60_000) })),
    ...(result.slots.length === 0
      ? { hint: "no slot fits: widen the window or the working hours, shorten the meeting, or lower the notice and buffers" }
      : {}),
    ...whole,
    ...(whole.complete ? {} : { warning: "these slots ignore the busy time listed in `unknown`; one may clash with it" }),
  };
};
