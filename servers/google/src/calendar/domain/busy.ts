import { type FreeReason, freeBecause, isTentative, whenOf } from "./events.js";
import type { RawEvent, RawFreeBusyCalendar, RawFreeBusyError, RawFreeBusyResponse, RawTimePeriod } from "./schema.js";
import { epochOf, type Interval, mergeIntervals } from "./time.js";

/**
 * Busy time: when the user, or someone they want to meet, cannot be booked.
 * Pure.
 *
 * Two sources, on purpose. The user's OWN calendars are read as events
 * (events.list), because the grant this server holds (calendar.events) allows
 * that and not freebusy.query, and because events say more than free/busy
 * does: which blocks are only tentative, and which day an all-day event covers
 * in its calendar's zone. OTHER people's calendars can only be read through
 * freebusy.query, which needs calendar.events.freebusy; that is `readAttendees`.
 *
 * What counts as busy is the agenda's own rule (`freeBecause` in events.ts):
 * cancelled, working-location, "show as available" and declined events are
 * free (freebusy.query leaves declined ones out too, so both sources agree).
 * On top of it, here:
 * - tentative (the event is marked tentative, or the user answered "maybe"):
 *   BUSY, flagged `tentative`, so a caller can choose to book over it.
 * - an invitation not answered yet: busy, as in Google's own free/busy.
 * - an all-day event left as busy: busy from local midnight to local midnight
 *   in its calendar's zone, every day it spans.
 */

export type Busy = Interval & {
  /** Held, not committed: the event is marked tentative, or the user answered "maybe". */
  readonly tentative: boolean;
};

export type BusyBlock = Busy & {
  /** A whole-day event, placed at local midnight in its calendar's zone. */
  readonly allDay: boolean;
};

export type EventVerdict =
  | { readonly kind: "busy"; readonly block: BusyBlock }
  | { readonly kind: "free"; readonly why: FreeReason | "zero_length" }
  /** Busy by every rule, but Google sent it without a usable start or end, so no one can say when. */
  | { readonly kind: "unplaceable" };

export const busyOf = (e: RawEvent, calendarTimeZone: string): EventVerdict => {
  const why = freeBecause(e);
  if (why) return { kind: "free", why };
  const start = whenOf(e.start);
  const end = whenOf(e.end);
  if (!start || !end) return { kind: "unplaceable" };
  const startMs = epochOf(start, calendarTimeZone);
  const endMs = epochOf(end, calendarTimeZone);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { kind: "unplaceable" };
  if (endMs <= startMs) return { kind: "free", why: "zero_length" };
  return {
    kind: "busy",
    block: { startMs, endMs, tentative: isTentative(e), allDay: start.kind === "date" },
  };
};

/** One calendar's busy blocks, and how many busy events could not be placed (reported, never dropped quietly). */
export const busyFromEvents = (
  events: readonly RawEvent[],
  calendarTimeZone: string,
): { readonly blocks: readonly BusyBlock[]; readonly unplaceable: number } => {
  const verdicts = events.map((e) => busyOf(e, calendarTimeZone));
  return {
    blocks: verdicts.flatMap((v) => (v.kind === "busy" ? [v.block] : [])),
    unplaceable: verdicts.filter((v) => v.kind === "unplaceable").length,
  };
};

/**
 * One timeline from any number of calendars: overlapping and touching blocks
 * become one, and the same meeting seen through both accounts counts once. A
 * merged block is tentative only if every block in it was; one firm meeting
 * inside makes the whole stretch firm.
 */
export const mergeBusy = (blocks: readonly Busy[]): readonly Busy[] =>
  mergeIntervals(
    blocks.map((b) => ({ startMs: b.startMs, endMs: b.endMs, tentative: b.tentative })),
    (a, b, span) => ({ ...span, tentative: a.tentative && b.tentative }),
  );

// ---- other people, through freebusy.query ------------------------------------------------------

export type AttendeeBusy =
  | { readonly kind: "known"; readonly email: string; readonly blocks: readonly Busy[] }
  | { readonly kind: "unknown"; readonly email: string; readonly reasons: readonly string[] };

/** Google's reasons, in words a person can act on. Unknown reasons pass through as Google named them. */
const REASONS: Readonly<Record<string, string>> = {
  notFound: "not visible to this account (notFound): the calendar is not shared with it, or the address has no Google calendar",
  internalError: "Google failed to compute it (internalError); retry",
  groupTooBig: "a group too large for one query (groupTooBig)",
  tooManyCalendarsRequested: "too many calendars in one query (tooManyCalendarsRequested)",
};

const reasonsOf = (errors: readonly RawFreeBusyError[]): readonly string[] =>
  errors.map((e) => (e.reason ? (REASONS[e.reason] ?? e.reason) : `unspecified error${e.domain ? ` (${e.domain})` : ""}`));

/**
 * A calendar's busy periods, or undefined when one of them cannot be placed.
 * An absent `busy` list means no busy time, which is how Google reports a free
 * calendar; a period without a start or an end makes the whole answer unsafe
 * to use, because the one missing block may be the meeting.
 */
const periodsOf = (busy: readonly RawTimePeriod[] | undefined): readonly Busy[] | undefined => {
  const placed = (busy ?? []).map((p) => {
    const startMs = p.start ? Date.parse(p.start) : Number.NaN;
    const endMs = p.end ? Date.parse(p.end) : Number.NaN;
    return Number.isNaN(startMs) || Number.isNaN(endMs) ? undefined : { startMs, endMs, tentative: false };
  });
  return placed.every((p) => p !== undefined) ? (placed as readonly Busy[]) : undefined;
};

/** Google echoes the id as it was sent; a case-insensitive second look costs nothing and survives a re-cased echo. */
const lookup = <T>(map: { readonly [key: string]: T } | null | undefined, id: string): T | undefined =>
  map?.[id] ?? Object.entries(map ?? {}).find(([key]) => key.toLowerCase() === id.toLowerCase())?.[1];

const fromCalendar = (email: string, entry: RawFreeBusyCalendar): AttendeeBusy => {
  if (entry.errors?.length) return { kind: "unknown", email, reasons: reasonsOf(entry.errors) };
  const blocks = periodsOf(entry.busy);
  return blocks
    ? { kind: "known", email, blocks }
    : { kind: "unknown", email, reasons: ["Google sent a busy period without a start or an end"] };
};

/**
 * Each requested address's busy time as one account sees it. An address
 * Google expanded as a group is busy whenever any member is, and unknown if
 * any member is unknown; an address Google did not answer for at all is
 * unknown, never free.
 */
export const readAttendees = (response: RawFreeBusyResponse, emails: readonly string[]): readonly AttendeeBusy[] =>
  emails.map((email): AttendeeBusy => {
    const entry = lookup(response.calendars, email);
    if (entry) return fromCalendar(email, entry);
    const group = lookup(response.groups, email);
    if (!group) return { kind: "unknown", email, reasons: ["Google returned no free/busy for this address"] };
    if (group.errors?.length) return { kind: "unknown", email, reasons: reasonsOf(group.errors) };
    const members = (group.calendars ?? []).map((id) => {
      const member = lookup(response.calendars, id);
      return member ? fromCalendar(id, member) : ({ kind: "unknown", email: id, reasons: ["Google returned no free/busy for this group member"] } as const);
    });
    if (members.length === 0) return { kind: "unknown", email, reasons: ["a group Google expanded to no members"] };
    const unknown = members.flatMap((m) => (m.kind === "unknown" ? m.reasons.map((r) => `${m.email}: ${r}`) : []));
    if (unknown.length) return { kind: "unknown", email, reasons: unknown };
    return { kind: "known", email, blocks: mergeBusy(members.flatMap((m) => (m.kind === "known" ? m.blocks : []))) };
  });
