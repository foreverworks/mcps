import { addDays } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import { epochOf, formatWithOffset, offsetOfText, parseWhen, type When } from "./time.js";
import type { RawAttendee, RawCalendar, RawEvent, RawWhen } from "./schema.js";
import { required } from "./errors.js";

export type { RawAttendee, RawCalendar, RawEvent, RawWhen };

/**
 * Events as the Calendar API returns them, and as this server hands them on.
 * Pure: no I/O, and no knowledge of how they were fetched.
 */





/** Where an event lives: one calendar of one account. Every write needs all three. */
export type EventRef = { readonly account: string; readonly calendarId: string; readonly eventId: string };

export type EventSummary = EventRef & {
  readonly calendar: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly status: string;
  /** Whether it blocks time. "Show as free" events and declined ones do not. */
  readonly busy: boolean;
  readonly myResponse?: string;
  readonly organizer?: string;
  readonly location?: string;
  readonly meetingUrl?: string;
  readonly attendees?: number;
  readonly recurring: boolean;
  readonly eventType?: string;
  readonly link?: string;
  /** The same event seen through another account or calendar, and dropped as a duplicate. */
  readonly alsoOn?: readonly string[];
};

export const calendarName = (c: RawCalendar): string => c.summaryOverride ?? c.summary ?? c.id ?? "(unnamed calendar)";

/** The raw end as a When, or undefined for an event Google sent without one. */
export const whenOf = (w: RawWhen | undefined): When | undefined =>
  w?.dateTime ? { kind: "dateTime", dateTime: w.dateTime } : w?.date ? { kind: "date", date: w.date } : undefined;

const selfAttendee = (e: RawEvent): RawAttendee | undefined => e.attendees?.find((a) => a.self);

/**
 * My answer to an invitation. An event I organise, or one with no guest list,
 * has no answer to give, so it gets none rather than a made-up "accepted".
 */
export const myResponse = (e: RawEvent): string | undefined => {
  if (e.organizer?.self) return undefined;
  return selfAttendee(e)?.responseStatus ?? undefined;
};

/**
 * Event types that are bookkeeping rather than appointments. A working-location
 * entry on every weekday would otherwise be half the agenda, and it says where,
 * not when, so it blocks no time either.
 */
const NOISE = new Set(["workingLocation"]);

export type FreeReason = "cancelled" | "not_an_appointment" | "transparent" | "declined";

/**
 * Why an event leaves its time free, or undefined when it blocks it. THE busy
 * rule: the agenda's `busy`, its conflicts, free_busy and find_time all read it.
 */
export const freeBecause = (e: RawEvent): FreeReason | undefined => {
  if (e.status === "cancelled") return "cancelled";
  if (NOISE.has(e.eventType ?? "")) return "not_an_appointment";
  if (e.transparency === "transparent") return "transparent";
  if (myResponse(e) === "declined") return "declined";
  return undefined;
};

/** Held, not committed: the event is marked tentative, or my answer is "maybe". Still busy. */
export const isTentative = (e: RawEvent): boolean => e.status === "tentative" || myResponse(e) === "tentative";

const meetingUrl = (e: RawEvent): string | undefined =>
  e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? undefined;

export const summarise = (account: string, calendar: RawCalendar, e: RawEvent): EventSummary => {
  const response = myResponse(e);
  const organizer = e.organizer?.self ? undefined : (e.organizer?.displayName ?? e.organizer?.email);
  const guests = e.attendees?.length ?? 0;
  return {
    account,
    calendarId: required(calendar.id, "calendar id"),
    eventId: required(e.id, "event id"),
    calendar: calendarName(calendar),
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: e.start?.date !== undefined && e.start.dateTime === undefined,
    status: e.status ?? "confirmed",
    busy: freeBecause(e) === undefined,
    ...(response ? { myResponse: response } : {}),
    ...(organizer ? { organizer } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(meetingUrl(e) ? { meetingUrl: meetingUrl(e) as string } : {}),
    ...(guests > 0 ? { attendees: guests } : {}),
    recurring: e.recurringEventId !== undefined || (e.recurrence?.length ?? 0) > 0,
    ...(e.eventType && e.eventType !== "default" ? { eventType: e.eventType } : {}),
    ...(e.htmlLink ? { link: e.htmlLink } : {}),
  };
};

/** Everything get_event shows beyond the summary: the words and the guest list. */
export const detail = (account: string, calendar: RawCalendar, e: RawEvent) => ({
  ...summarise(account, calendar, e),
  ...(e.description ? { description: e.description } : {}),
  guests: (e.attendees ?? []).map((a) => ({
    email: a.email ?? "",
    ...(a.displayName ? { name: a.displayName } : {}),
    response: a.responseStatus ?? "needsAction",
    ...(a.organizer ? { organizer: true } : {}),
    ...(a.optional ? { optional: true } : {}),
    ...(a.self ? { self: true } : {}),
  })),
  reminders: e.reminders?.useDefault
    ? "calendar default"
    : (e.reminders?.overrides ?? []).map((r) => `${r.method ?? "popup"} ${r.minutes ?? 0} min before`),
  ...(e.recurrence ? { recurrence: e.recurrence } : {}),
  ...(e.recurringEventId ? { seriesId: e.recurringEventId } : {}),
});

// ---- the agenda ---------------------------------------------------------------------------------

export type Fetched = { readonly account: string; readonly calendar: RawCalendar; readonly events: readonly RawEvent[] };

export type AgendaOptions = { readonly includeDeclined: boolean; readonly timeZone: string };

export type Conflict = {
  readonly a: EventRef & { readonly title: string; readonly start: string; readonly end: string };
  readonly b: EventRef & { readonly title: string; readonly start: string; readonly end: string };
  readonly overlapMinutes: number;
  /**
   * Same interval, and one title contains the other: one appointment booked into both accounts
   * as two separate events (a booking site mailing both addresses), which no iCalUID can join.
   */
  readonly probablySameEvent?: true;
};

const normalTitle = (t: string): string => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const sameAppointment = (x: Timed, y: Timed): boolean => {
  if (x.startMs !== y.startMs || x.endMs !== y.endMs) return false;
  const a = normalTitle(x.event.title);
  const b = normalTitle(y.event.title);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
};

type Timed = { readonly event: EventSummary; readonly startMs: number; readonly endMs: number };

const timed = (e: EventSummary, timeZone: string): Timed | undefined => {
  const s = whenOf(e.allDay ? { date: e.start } : { dateTime: e.start });
  const en = whenOf(e.allDay ? { date: e.end } : { dateTime: e.end });
  if (!s || !en) return undefined;
  return { event: e, startMs: epochOf(s, timeZone), endMs: epochOf(en, timeZone) };
};

/**
 * One list across every account and calendar, in time order, with duplicates
 * folded.
 *
 * A duplicate is the same iCalUID at the same start: an invitation sent to both
 * mailboxes, or a calendar shared from one account into the other. The iCalUID
 * alone is not enough, because every instance of a recurring series shares it.
 * The first sighting wins, in the order the accounts were fetched, and the
 * others are named in `alsoOn` so nothing silently disappears.
 */
export const mergeAgenda = (fetched: readonly Fetched[], options: AgendaOptions): readonly EventSummary[] => {
  const byKey = new Map<string, { event: EventSummary; alsoOn: string[] }>();
  const order: string[] = [];
  for (const { account, calendar, events } of fetched) {
    for (const raw of events) {
      if (raw.status === "cancelled" || NOISE.has(raw.eventType ?? "")) continue;
      const event = summarise(account, calendar, raw);
      if (!options.includeDeclined && event.myResponse === "declined") continue;
      const key = raw.iCalUID ? `${raw.iCalUID}@${event.start}` : `${account}/${calendar.id}/${raw.id}`;
      const seen = byKey.get(key);
      if (seen) {
        seen.alsoOn.push(`${account}/${event.calendar}`);
        continue;
      }
      byKey.set(key, { event, alsoOn: [] });
      order.push(key);
    }
  }
  const merged = order.map((k) => {
    const { event, alsoOn } = byKey.get(k) as { event: EventSummary; alsoOn: string[] };
    return alsoOn.length ? { ...event, alsoOn } : event;
  });
  const startOf = (e: EventSummary) => timed(e, options.timeZone)?.startMs ?? 0;
  return [...merged].sort((x, y) => startOf(x) - startOf(y));
};

const refOf = (e: EventSummary) => ({
  account: e.account,
  calendarId: e.calendarId,
  eventId: e.eventId,
  title: e.title,
  start: e.start,
  end: e.end,
});

/**
 * Every pair of timed, busy events that overlap. All-day entries are left out:
 * a birthday or a holiday does not clash with a meeting, and treating them as
 * 24-hour blocks would flag everything on that day.
 */
export const findConflicts = (events: readonly EventSummary[], timeZone: string): readonly Conflict[] => {
  const blocks = events
    .filter((e) => e.busy && !e.allDay && e.status !== "cancelled")
    .flatMap((e) => timed(e, timeZone) ?? [])
    .sort((x, y) => x.startMs - y.startMs);
  const conflicts: Conflict[] = [];
  const open: Timed[] = [];
  for (const block of blocks) {
    // Anything that ended by the time this one starts cannot overlap it or anything after it.
    for (let i = open.length - 1; i >= 0; i -= 1) if ((open[i] as Timed).endMs <= block.startMs) open.splice(i, 1);
    for (const other of open) {
      const overlap = Math.min(other.endMs, block.endMs) - block.startMs;
      if (overlap > 0) {
        conflicts.push({
          a: refOf(other.event),
          b: refOf(block.event),
          overlapMinutes: Math.round(overlap / 60_000),
          ...(sameAppointment(other, block) ? { probablySameEvent: true as const } : {}),
        });
      }
    }
    open.push(block);
  }
  return conflicts;
};

/** Invitations still waiting for my answer. */
export const pendingInvites = (events: readonly EventSummary[]): readonly EventSummary[] =>
  events.filter((e) => e.myResponse === "needsAction");

// ---- writing ------------------------------------------------------------------------------------

export type EventInput = {
  readonly title?: string;
  readonly start?: string;
  readonly end?: string;
  readonly durationMinutes?: number;
  readonly location?: string;
  readonly description?: string;
  readonly attendees?: readonly string[];
  readonly remindersMinutes?: readonly number[];
  readonly busy?: boolean;
  /** RFC 5545 lines: RRULE, EXDATE, RDATE. `["RRULE:FREQ=YEARLY"]` is a birthday. */
  readonly recurrence?: readonly string[];
  /** A new Google Meet link for the event; on an update, added to an event that has none. */
  readonly meet?: boolean;
  /** What the event is. Fixed when it is created: Google refuses to change it later. */
  readonly kind?: EventKind;
  /** Focus time and out of office: which invitations Calendar declines for the user while it lasts. */
  readonly autoDecline?: AutoDecline;
  /** The note a decline carries. */
  readonly declineMessage?: string;
  /** Focus time only: the status Chat shows meanwhile. */
  readonly chatStatus?: ChatStatus;
};

/**
 * An appointment, a block of focus time, or time out of office. The last two
 * are what Google calls status events: on a primary calendar only, never all
 * day, always busy, and with no guests; Google offers them to Workspace users
 * and refuses them elsewhere in its own words.
 */
export const EVENT_KINDS = ["default", "focusTime", "outOfOffice"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** none: decline nothing (the default here, since a decline is mail to the organiser); all: every conflicting invitation, those already accepted too; new: only invitations that arrive while it is on the calendar. */
export const AUTO_DECLINES = ["none", "all", "new"] as const;
export type AutoDecline = (typeof AUTO_DECLINES)[number];
export type ChatStatus = "available" | "doNotDisturb";

const AUTO_DECLINE_MODE: Readonly<Record<AutoDecline, string>> = {
  none: "declineNone",
  all: "declineAllConflictingInvitations",
  new: "declineOnlyNewConflictingInvitations",
};

/** The status event an existing event is, if it is one. */
const statusKindOf = (e: RawEvent | undefined): Exclude<EventKind, "default"> | undefined =>
  e?.eventType === "focusTime" || e?.eventType === "outOfOffice" ? e.eventType : undefined;

const DEFAULT_TITLE: Readonly<Record<Exclude<EventKind, "default">, string>> = { focusTime: "Focus time", outOfOffice: "Out of office" };

/** Whether the event carries a link to a call already. */
export const hasMeetingLink = (e: RawEvent): boolean => meetingUrl(e) !== undefined;

/** The fields that make a status event what it is: its type, its properties, and the busy time it must block. */
const statusFields = (input: EventInput, kind: Exclude<EventKind, "default">, existing?: RawEvent): Record<string, unknown> => {
  if (input.chatStatus !== undefined && kind !== "focusTime") return fail(inputError("chat_status is for focus time only"));
  const key = kind === "focusTime" ? "focusTimeProperties" : "outOfOfficeProperties";
  const before = (existing?.[key] ?? {}) as Record<string, unknown>;
  const touched = input.autoDecline !== undefined || input.declineMessage !== undefined || input.chatStatus !== undefined;
  if (existing && !touched) return {};
  const properties = {
    ...before,
    autoDeclineMode: input.autoDecline !== undefined ? AUTO_DECLINE_MODE[input.autoDecline] : (before["autoDeclineMode"] ?? AUTO_DECLINE_MODE.none),
    ...(input.declineMessage !== undefined ? { declineMessage: input.declineMessage } : {}),
    ...(input.chatStatus !== undefined ? { chatStatus: input.chatStatus } : {}),
  };
  return { ...(existing ? {} : { eventType: kind, transparency: "opaque" }), [key]: properties };
};

/**
 * What only some kinds of event take, checked before anything is built: the
 * rules Google applies to status events, said in this server's words.
 */
const checkKind = (input: EventInput, existing?: RawEvent): Exclude<EventKind, "default"> | undefined => {
  if (existing && input.kind !== undefined && input.kind !== (statusKindOf(existing) ?? "default")) {
    return fail(inputError(`an event's type cannot change once it exists (this one is ${existing.eventType ?? "default"}); delete it and create the other kind`));
  }
  const kind = existing ? statusKindOf(existing) : input.kind === "default" ? undefined : input.kind;
  if (!kind) {
    if (input.autoDecline !== undefined || input.declineMessage !== undefined || input.chatStatus !== undefined) {
      return fail(inputError("auto_decline, decline_message and chat_status are for focus time and out of office events only"));
    }
    return undefined;
  }
  const what = kind === "focusTime" ? "focus time" : "an out of office event";
  if (input.attendees?.length) return fail(inputError(`${what} has no guests`));
  if (input.meet) return fail(inputError(`${what} has no meeting link`));
  if (input.busy === false) return fail(inputError(`${what} always blocks its time; it cannot be shown as free`));
  return kind;
};

/** The request that makes Google create a Meet call for the event; requestId keeps a resent request from making a second one. */
const meetRequest = (requestId: string) => ({ conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECURRENCE_LINE = /^(RRULE|EXRULE|RDATE|EXDATE)[;:]/;
const DEFAULT_MINUTES = 60;

const rawWhen = (w: When, timeZone: string): RawWhen =>
  w.kind === "date" ? { date: w.date } : { dateTime: w.dateTime, timeZone };

/**
 * The start and end to send, from what the caller gave and, on an update, what
 * the event already has.
 *
 * - A whole day with no end is that one day (Google's end date is exclusive).
 * - A timed start with no end runs for `durationMinutes`, else for as long as
 *   the event already ran (so moving a meeting keeps its length), else an hour.
 * - A day and a time cannot be mixed, and an end must come after its start.
 */
const span = (input: EventInput, timeZone: string, existing?: RawEvent): { start: RawWhen; end: RawWhen } | undefined => {
  if (input.start === undefined && input.end === undefined && input.durationMinutes === undefined) return undefined;
  const oldStart = whenOf(existing?.start);
  const oldEnd = whenOf(existing?.end);
  const start = input.start !== undefined ? parseWhen(input.start, timeZone) : oldStart;
  if (!start) return fail(inputError("an event needs a start"));

  let end: When | undefined;
  if (input.end !== undefined) {
    end = parseWhen(input.end, timeZone);
  } else if (start.kind === "date") {
    const days = oldStart?.kind === "date" && oldEnd?.kind === "date" && input.start !== undefined
      ? Math.max(1, Math.round((Date.parse(oldEnd.date) - Date.parse(oldStart.date)) / 86_400_000))
      : 1;
    end = input.start === undefined && oldEnd ? oldEnd : { kind: "date", date: addDays(start.date, days) };
  } else {
    const minutes =
      input.durationMinutes ??
      (oldStart?.kind === "dateTime" && oldEnd?.kind === "dateTime"
        ? (Date.parse(oldEnd.dateTime) - Date.parse(oldStart.dateTime)) / 60_000
        : DEFAULT_MINUTES);
    const endMs = Date.parse(start.dateTime) + minutes * 60_000;
    end = input.start === undefined && input.durationMinutes === undefined && oldEnd ? oldEnd : isoWithOffsetOf(start.dateTime, endMs);
  }

  if (start.kind !== end.kind) return fail(inputError("start and end must both be dates (all day) or both be times"));
  const startMs = epochOf(start, timeZone);
  const endMs = epochOf(end, timeZone);
  if (endMs <= startMs) return fail(inputError(`the end (${input.end ?? "derived"}) is not after the start`));
  return { start: rawWhen(start, timeZone), end: rawWhen(end, timeZone) };
};

/** An instant in the same offset as a reference RFC 3339 string, so the output reads in the caller's zone. */
const isoWithOffsetOf = (reference: string, epochMs: number): When => ({
  kind: "dateTime",
  dateTime: formatWithOffset(epochMs, offsetOfText(reference)),
});

/**
 * The request body for a new event, or the PATCH for an existing one. Only
 * what the caller set is sent, so an update never blanks a field it was not
 * asked about.
 */
export const eventBody = (input: EventInput, timeZone: string, existing?: RawEvent, requestId?: string): Record<string, unknown> => {
  const kind = checkKind(input, existing);
  // A status event's title is optional: an empty one takes the name Google's own apps give it.
  const title = kind && !existing && !input.title?.trim() ? DEFAULT_TITLE[kind] : input.title;
  if (!existing && !title?.trim()) return fail(inputError("a new event needs a title"));
  if (!existing && input.start === undefined) return fail(inputError("a new event needs a start"));
  const bad = (input.attendees ?? []).filter((a) => !EMAIL.test(a.trim()));
  if (bad.length) return fail(inputError(`not email addresses: ${bad.join(", ")}`));
  if (input.durationMinutes !== undefined && !(input.durationMinutes > 0)) return fail(inputError("duration_minutes must be positive"));
  if ((input.remindersMinutes ?? []).some((m) => !(m >= 0 && m <= 40_320))) {
    return fail(inputError("reminder minutes must be between 0 and 40320 (four weeks)"));
  }

  const badRule = (input.recurrence ?? []).filter((line) => !RECURRENCE_LINE.test(line.trim()));
  if (badRule.length) return fail(inputError(`not RFC 5545 recurrence lines (RRULE:, EXDATE:, RDATE:): ${badRule.join(", ")}`));

  const times = span(input, timeZone, existing);
  if (kind && (times?.start.date !== undefined || (times === undefined && existing?.start?.date !== undefined))) {
    return fail(inputError(`${kind === "focusTime" ? "focus time" : "an out of office event"} cannot be all day: give a start and an end with times`));
  }
  if (input.meet && existing && hasMeetingLink(existing)) return fail(inputError("the event already has a meeting link; get_event shows it"));
  if (input.meet && requestId === undefined) return fail(inputError("a Meet link needs a request id"));
  return {
    ...(title !== undefined ? { summary: title } : {}),
    ...(times ?? {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.attendees !== undefined ? { attendees: input.attendees.map((email) => ({ email: email.trim() })) } : {}),
    ...(input.remindersMinutes !== undefined
      ? { reminders: { useDefault: false, overrides: input.remindersMinutes.map((minutes) => ({ method: "popup", minutes })) } }
      : {}),
    ...(input.busy !== undefined ? { transparency: input.busy ? "opaque" : "transparent" } : {}),
    ...(input.recurrence !== undefined ? { recurrence: input.recurrence.map((line) => line.trim()) } : {}),
    ...(input.meet && requestId !== undefined ? meetRequest(requestId) : {}),
    ...(kind ? statusFields(input, kind, existing) : {}),
  };
};

/**
 * Whether a Meet link asked for is still being made. Google usually creates
 * it within the insert, and otherwise answers "pending" and adds it shortly.
 */
export const meetPending = (e: RawEvent): boolean => !hasMeetingLink(e) && e.conferenceData?.createRequest?.status?.statusCode === "pending";

/** Whether Google answered that it could not make the Meet link asked for (a calendar that allows no Meet calls, for one). */
export const meetFailed = (e: RawEvent): boolean => !hasMeetingLink(e) && e.conferenceData?.createRequest?.status?.statusCode === "failure";

export type Rsvp = "accepted" | "declined" | "tentative";

/**
 * The attendee list with my answer changed, and nobody else's. Refused when I
 * am not on the list: answering an event I organise, or one that only landed
 * on my calendar, means nothing to its organiser.
 */
export const withMyResponse = (e: RawEvent, response: Rsvp): readonly RawAttendee[] => {
  if (e.organizer?.self) return fail(inputError("this is your own event; there is no invitation to answer"));
  if (!selfAttendee(e)) return fail(inputError("you are not on this event's guest list, so there is no invitation to answer"));
  return (e.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: response } : a));
};

/** Whether an event is a whole series (the event that carries the recurrence rule), not one occurrence of it. */
export const isSeries = (e: RawEvent): boolean => (e.recurrence?.length ?? 0) > 0;

/** Who a new guest list adds and who it drops, against the event as it was: what a replaced list means. */
export const guestChange = (before: RawEvent, after: readonly string[]): { readonly added: readonly string[]; readonly removed: readonly string[] } => {
  const was = new Set((before.attendees ?? []).flatMap((a) => (a.email ? [a.email.trim().toLowerCase()] : [])));
  const now = new Set(after.map((email) => email.trim().toLowerCase()));
  return { added: [...now].filter((e) => !was.has(e)), removed: [...was].filter((e) => !now.has(e)) };
};
