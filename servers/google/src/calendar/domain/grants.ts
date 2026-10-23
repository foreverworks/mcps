/**
 * The scopes this server's grant must carry. Pure.
 *
 * Two narrow scopes rather than the whole `calendar` one:
 *   calendar.events                      read and write events on every calendar the account can see
 *   calendar.calendarlist.readonly       which calendars those are, and which one is primary
 * Neither can change a calendar's sharing, delete a calendar or touch settings,
 * which is everything the full scope adds and nothing an agenda needs.
 */
import { SCOPE_ROOT as SCOPE } from "../../domain/scopes.js";

export { splitScopes } from "../../domain/scopes.js";
export const CALENDAR_EVENTS = `${SCOPE}calendar.events`;
export const CALENDAR_LIST_READONLY = `${SCOPE}calendar.calendarlist.readonly`;
/** The full scope, never requested; recognised so a check does not misjudge a wider grant. */
export const CALENDAR_FULL = `${SCOPE}calendar`;

export const REQUIRED_SCOPES = [CALENDAR_EVENTS, CALENDAR_LIST_READONLY] as const;

/** The full scope covers both, so a grant holding it is missing nothing. */
export const missingScopes = (granted: readonly string[]): readonly string[] =>
  granted.includes(CALENDAR_FULL) ? [] : REQUIRED_SCOPES.filter((s) => !granted.includes(s));

export const canWrite = (granted: readonly string[]): boolean =>
  granted.includes(CALENDAR_EVENTS) || granted.includes(CALENDAR_FULL);

/**
 * Other people's availability, which only freebusy.query answers, and which
 * calendar.events does NOT open (the Discovery document lists calendar,
 * calendar.readonly, calendar.freebusy and calendar.events.freebusy for it).
 * calendar.freebusy covers only the account's own calendars, so the scope
 * asked for is calendar.events.freebusy: busy/free of every calendar the
 * account can see, and nothing about what the events are.
 *
 * OPTIONAL, not in REQUIRED_SCOPES: the user's own free/busy is computed from
 * events, which the two required scopes already allow, so a grant without it
 * is healthy and only the `attendees` of free_busy and find_time are refused.
 */
export const CALENDAR_EVENTS_FREEBUSY = `${SCOPE}calendar.events.freebusy`;
const CALENDAR_READONLY = `${SCOPE}calendar.readonly`;

export const canReadAttendeeFreeBusy = (granted: readonly string[]): boolean =>
  [CALENDAR_EVENTS_FREEBUSY, CALENDAR_READONLY, CALENDAR_FULL].some((s) => granted.includes(s));
