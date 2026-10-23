import { type AttendeeBusy, type Busy, type BusyBlock, busyFromEvents, mergeBusy, readAttendees } from "../../domain/busy.js";
import { authError, describeThrown, fail } from "../../domain/errors.js";
import { calendarName } from "../../domain/events.js";
import { CALENDAR_EVENTS_FREEBUSY, canReadAttendeeFreeBusy } from "../../domain/grants.js";
import type { Deps } from "../ports.js";
import { type CalendarChoice, fetchEvents, type Failure } from "./fetch.js";

/**
 * Gathering busy time across accounts: the I/O half of free_busy and
 * find_time. The user's calendars come through the agenda's own listing
 * (fetch.ts); other people through freebusy.query.
 *
 * Nothing that fails is dropped. A dead account, a calendar Google refused, a
 * calendar with events that cannot be placed, an attendee nobody can see: each
 * lands in `unknown`, beside the busy time that did arrive, because a slot
 * offered over a meeting nobody could read is worse than no slot.
 */

/** Two months: long enough for "sometime in the next weeks", short enough that one page of events per calendar covers it. */
export const MAX_BUSY_DAYS = 62;

/**
 * The most events read from one calendar for one window. A calendar that
 * reaches it may have more, which is reported rather than ignored: the missing
 * ones would be busy time nobody sees.
 */
export const EVENTS_CAP = 2500;

/** Something whose busy time is missing from the answer, and why. */
export type Unknown = Failure & { readonly attendee?: string };

export type CalendarBusy = {
  readonly account: string;
  readonly calendarId: string;
  readonly calendar: string;
  readonly blocks: readonly BusyBlock[];
};

export type AttendeeResult =
  | { readonly kind: "known"; readonly email: string; readonly seenBy: readonly string[]; readonly blocks: readonly Busy[] }
  | { readonly kind: "unknown"; readonly email: string; readonly reasons: readonly string[] };

export type Gathered = {
  readonly calendars: readonly CalendarBusy[];
  readonly attendees: readonly AttendeeResult[];
  readonly unknown: readonly Unknown[];
};

type Span = { readonly timeMin: string; readonly timeMax: string };

/** Each account's own calendars, as busy blocks, from the same listing the agenda reads. */
const ownBusy = async (accounts: readonly Deps[], span: Span, choice: CalendarChoice, timeZone: string) => {
  const { fetched, failures } = await fetchEvents(accounts, choice, { ...span, limit: EVENTS_CAP });
  const read = fetched.map(({ account, calendar, events }) => {
    const name = calendarName(calendar);
    // An all-day event covers a day in ITS calendar's zone; the server's zone only when the list did not say.
    const { blocks, unplaceable } = busyFromEvents(events, calendar.timeZone ?? timeZone);
    const problems = [
      ...(events.length >= EVENTS_CAP ? [`${EVENTS_CAP} or more events in the window, and the rest were not read; narrow the window`] : []),
      ...(unplaceable > 0 ? [`${unplaceable} busy event(s) came without a usable start or end, so their time is not counted`] : []),
    ];
    return {
      // fetchEvents only reads a calendar that has an id, so the fallback never shows.
      calendar: { account, calendarId: calendar.id ?? name, calendar: name, blocks },
      unknown: problems.map((error) => ({ account, calendar: name, error })),
    };
  });
  return { calendars: read.map((r) => r.calendar), unknown: [...failures, ...read.flatMap((r) => r.unknown)] };
};

type AccountAnswer = { readonly account: string; readonly read: readonly AttendeeBusy[] } | { readonly account: string; readonly error: string };

/** One account's view of other people, through freebusy.query; refused before any request when the grant cannot ask. */
const askAccount = async (deps: Deps, span: Span, emails: readonly string[]): Promise<AccountAnswer> => {
  try {
    const granted = await deps.grant.scopes();
    if (!canReadAttendeeFreeBusy(granted)) {
      return fail(
        authError(
          "insufficient_scope",
          `account "${deps.account}"'s grant carries "${granted.join(" ")}", not ${CALENDAR_EVENTS_FREEBUSY}, which other people's free/busy needs; its own calendars were still read`,
        ),
      );
    }
    return { account: deps.account, read: readAttendees(await deps.calendar.freeBusy({ ...span, ids: emails }), emails) };
  } catch (thrown) {
    return { account: deps.account, error: describeThrown(thrown) };
  }
};

/**
 * Other people, asked through every account. An attendee is KNOWN when any
 * account can see their free/busy (a colleague through a work account, a
 * friend who shared with a personal one); the accounts that could not see them, or could not
 * ask at all, are not an error then. An attendee no account can see is
 * unknown, never free.
 */
const attendeeBusy = async (
  accounts: readonly Deps[],
  span: Span,
  emails: readonly string[],
): Promise<{ readonly attendees: readonly AttendeeResult[]; readonly unknown: readonly Unknown[] }> => {
  if (emails.length === 0) return { attendees: [], unknown: [] };
  const answers = await Promise.all(accounts.map((deps) => askAccount(deps, span, emails)));
  const accountErrors = answers.flatMap((a) => ("error" in a ? [{ account: a.account, error: `attendees' free/busy: ${a.error}` }] : []));
  const attendees = emails.map((email): AttendeeResult => {
    const views = answers.flatMap((a) => ("read" in a ? a.read.filter((r) => r.email === email).map((r) => ({ account: a.account, view: r })) : []));
    const known = views.flatMap(({ account, view }) => (view.kind === "known" ? [{ account, blocks: view.blocks }] : []));
    if (known.length > 0) return { kind: "known", email, seenBy: known.map((k) => k.account), blocks: mergeBusy(known.flatMap((k) => k.blocks)) };
    const reasons = views.flatMap(({ account, view }) => (view.kind === "unknown" ? view.reasons.map((r) => `${account}: ${r}`) : []));
    return { kind: "unknown", email, reasons: reasons.length ? reasons : ["no account could be asked; see the account errors"] };
  });
  const missing = attendees.flatMap((a) => (a.kind === "unknown" ? [{ attendee: a.email, error: a.reasons.join("; ") }] : []));
  // An account that could not ask matters only while someone is still unknown; otherwise another account answered for it.
  return { attendees, unknown: missing.length ? [...accountErrors, ...missing] : [] };
};

/** Everything busy in the span: each account's own calendars (the ones `calendars` picks) and the attendees. */
export const gatherBusy = async (
  accounts: readonly Deps[],
  span: Span,
  request: { readonly calendars: CalendarChoice; readonly attendees: readonly string[] },
  timeZone: string,
): Promise<Gathered> => {
  const [own, others] = await Promise.all([ownBusy(accounts, span, request.calendars, timeZone), attendeeBusy(accounts, span, request.attendees)]);
  return { calendars: own.calendars, attendees: others.attendees, unknown: [...own.unknown, ...others.unknown] };
};
