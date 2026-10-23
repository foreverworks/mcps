import { describeThrown, required } from "../../domain/errors.js";
import { calendarName, type Fetched, type RawCalendar } from "../../domain/events.js";
import type { Deps, Window } from "../ports.js";

/** "selected" (what the Calendar UI shows), "primary", "all", or calendar ids or names. */
export type CalendarChoice = "selected" | "primary" | "all" | readonly string[];

/** One thing that could not be read, reported beside everything that could. */
export type Failure = { readonly account?: string; readonly calendar?: string; readonly error: string };

/** Which of an account's calendars a read covers. Hidden ones only when asked by id or for "all". */
export const pickCalendars = (all: readonly RawCalendar[], wanted: CalendarChoice): readonly RawCalendar[] => {
  if (wanted === "all") return all;
  if (wanted === "primary") return all.filter((c) => c.primary);
  if (wanted === "selected") return all.filter((c) => c.primary || (c.selected && !c.hidden));
  return all.filter((c) => wanted.includes(c.id ?? "") || wanted.includes(calendarName(c)));
};

type AccountRead = { readonly names?: readonly string[]; readonly fetched: readonly Fetched[]; readonly failures: readonly Failure[] };

const readAccount = async (deps: Deps, choice: CalendarChoice, window: Window): Promise<AccountRead> => {
  let calendars: readonly RawCalendar[];
  try {
    calendars = pickCalendars(await deps.calendar.calendars(), choice);
  } catch (thrown) {
    return { fetched: [], failures: [{ account: deps.account, error: describeThrown(thrown) }] };
  }
  const read = await Promise.all(
    calendars.map(async (calendar): Promise<{ readonly fetched?: Fetched; readonly failure?: Failure }> => {
      try {
        return { fetched: { account: deps.account, calendar, events: await deps.calendar.events(required(calendar.id, "calendar id"), window) } };
      } catch (thrown) {
        return { failure: { account: deps.account, calendar: calendarName(calendar), error: describeThrown(thrown) } };
      }
    }),
  );
  return {
    names: calendars.flatMap((c) => [c.id ?? "", calendarName(c)]),
    // Primary first, so a duplicate keeps the user's own copy rather than a subscription's.
    fetched: read
      .flatMap((r) => (r.fetched ? [r.fetched] : []))
      .sort((a, b) => Number(b.calendar.primary ?? false) - Number(a.calendar.primary ?? false)),
    failures: read.flatMap((r) => (r.failure ? [r.failure] : [])),
  };
};

/**
 * The events of every calendar `choice` picks, in every account, over one
 * window: THE listing behind agenda, free_busy and find_time, so they cannot
 * disagree about which calendars count.
 *
 * One dead account or calendar does not blank the others: its failure is
 * reported beside the events that did arrive. A calendar asked for by id that
 * no account lists is a failure too (a typo must not read as an empty
 * calendar), unless an account whose list failed might have held it.
 */
export const fetchEvents = async (
  accounts: readonly Deps[],
  choice: CalendarChoice,
  window: Window,
): Promise<{ readonly fetched: readonly Fetched[]; readonly failures: readonly Failure[] }> => {
  const reads = await Promise.all(accounts.map((deps) => readAccount(deps, choice, window)));
  const everyListRead = reads.every((r) => r.names !== undefined);
  const names = new Set(reads.flatMap((r) => r.names ?? []));
  const unmatched = typeof choice === "string" || !everyListRead ? [] : choice.filter((id) => !names.has(id));
  return {
    fetched: reads.flatMap((r) => r.fetched),
    failures: [
      ...reads.flatMap((r) => r.failures),
      ...unmatched.map((calendar) => ({ calendar, error: "no account's calendar list has this calendar; list_calendars shows the ids" })),
    ],
  };
};
