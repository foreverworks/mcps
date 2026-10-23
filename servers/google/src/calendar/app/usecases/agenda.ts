import { calendarName, findConflicts, mergeAgenda, pendingInvites } from "../../domain/events.js";
import { describeThrown, fail, inputError } from "../../domain/errors.js";
import { windowOf } from "../../domain/time.js";
import type { Deps } from "../ports.js";
import { type CalendarChoice, fetchEvents, pickCalendars } from "./fetch.js";

export type AgendaRequest = {
  /** YYYY-MM-DD or a time; empty means today in the server's zone. */
  readonly from: string;
  /** Exclusive. Empty means `days` after `from`. */
  readonly to: string;
  readonly days: number;
  readonly calendars: CalendarChoice;
  readonly query?: string;
  readonly includeDeclined: boolean;
  readonly limit: number;
};

/** A year: the longest window an agenda reads. */
const MAX_AGENDA_DAYS = 366;

/** A real clash, or one appointment that landed in both accounts: reported apart, so a clash means one. */
const splitConflicts = (all: ReturnType<typeof findConflicts>) => {
  const duplicates = all.filter((c) => c.probablySameEvent);
  return { conflicts: all.filter((c) => !c.probablySameEvent), ...(duplicates.length ? { probableDuplicates: duplicates } : {}) };
};

/**
 * The user's time across every account at once: one list in time order, the
 * clashes between them, and the invitations still waiting for an answer.
 *
 * The clash is the reason this spans accounts. A work meeting and a dentist
 * appointment live in different Google accounts, and neither calendar alone can
 * see that they collide.
 *
 * One dead account does not blank the others: its failure is reported beside
 * the events that did arrive.
 */
export const agenda = async (accounts: readonly Deps[], request: AgendaRequest) => {
  const first = accounts[0];
  if (!first) return fail(inputError("no account to read"));
  const timeZone = first.timeZone;
  const { timeMin, timeMax } = windowOf(request, timeZone, first.now(), MAX_AGENDA_DAYS);
  const window = { timeMin, timeMax, limit: request.limit, ...(request.query ? { query: request.query } : {}) };
  const { fetched, failures } = await fetchEvents(accounts, request.calendars, window);

  const merged = mergeAgenda(fetched, { includeDeclined: request.includeDeclined, timeZone });
  const events = merged.slice(0, request.limit);
  return {
    timeZone,
    from: timeMin,
    to: timeMax,
    accounts: accounts.map((d) => d.account),
    events,
    ...(merged.length > events.length ? { truncated: `${merged.length - events.length} more; narrow the window or raise limit` } : {}),
    ...splitConflicts(findConflicts(events, timeZone)),
    pendingInvites: pendingInvites(events).map((e) => ({ account: e.account, calendarId: e.calendarId, eventId: e.eventId, title: e.title, start: e.start, organizer: e.organizer })),
    ...(failures.length ? { failures } : {}),
  };
};

/** Every calendar of every account, with what an agenda would read by default. */
export const listCalendars = async (accounts: readonly Deps[]) =>
  Promise.all(
    accounts.map(async (deps) => {
      try {
        const all = await deps.calendar.calendars();
        const shown = new Set(pickCalendars(all, "selected").map((c) => c.id));
        return {
          account: deps.account,
          calendars: all.map((c) => ({
            id: c.id,
            name: calendarName(c),
            primary: c.primary === true,
            access: c.accessRole ?? "unknown",
            inAgendaByDefault: shown.has(c.id),
            ...(c.timeZone ? { timeZone: c.timeZone } : {}),
          })),
        };
      } catch (thrown) {
        return { account: deps.account, error: describeThrown(thrown) };
      }
    }),
  );
