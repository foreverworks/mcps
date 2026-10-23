import { authError, fail, inputError } from "../../domain/errors.js";
import {
  detail,
  eventBody,
  type EventInput,
  guestChange,
  isSeries,
  meetFailed,
  meetPending,
  type RawCalendar,
  type RawEvent,
  type Rsvp,
  summarise,
  withMyResponse,
} from "../../domain/events.js";
import { canWrite } from "../../domain/grants.js";
import type { Deps, SendUpdates } from "../ports.js";

/**
 * Every write calls this FIRST, before it reads or builds anything. The granted
 * scope is recorded when the access token is minted, so on the common path the
 * check costs nothing; when the events box was left unticked on Google's
 * granular consent screen, the write refuses here instead of as a bare 403.
 */
const requireWrite = async (deps: Deps): Promise<void> => {
  const granted = await deps.grant.scopes();
  if (!canWrite(granted)) {
    return fail(
      authError(
        "insufficient_scope",
        `account "${deps.account}"'s grant (${deps.grant.credentials}) carries "${granted.join(" ")}", not calendar.events. Nothing was changed.`,
      ),
    );
  }
};

/**
 * The calendar an event lives on, for naming it in results. The list is one
 * call; a calendar the list does not know (an id typed by hand) still works,
 * named by its id.
 */
const calendarOf = async (deps: Deps, calendarId: string): Promise<RawCalendar> => {
  const all = await deps.calendar.calendars();
  if (calendarId === "primary") return all.find((c) => c.primary) ?? { id: "primary", primary: true };
  return all.find((c) => c.id === calendarId) ?? { id: calendarId };
};

/** How far a change reaches: the one event (or occurrence) named, or a whole series named by its own id. */
export type Scope = "one" | "series";

/**
 * A series id changes or deletes every occurrence, past ones included; an
 * instance id from agenda touches one. The first is refused unless the caller
 * said `series`, because the two ids look alike and only one of them is what
 * "move Tuesday's meeting" means.
 */
const checkScope = (existing: RawEvent, scope: Scope, verb: string): void => {
  if (isSeries(existing) && scope !== "series") {
    fail(
      inputError(
        `"${existing.summary ?? "(no title)"}" is a recurring series (${(existing.recurrence ?? []).join("; ")}): this would ${verb} every occurrence. ` +
          "Pass scope: \"series\" to mean that, or use one occurrence's eventId from agenda",
      ),
    );
  }
};

export const getEvent = async (deps: Deps, calendarId: string, eventId: string) => {
  const [calendar, event] = await Promise.all([calendarOf(deps, calendarId), deps.calendar.get(calendarId, eventId)]);
  return detail(deps.account, calendar, event);
};

/** A Meet link still being made says so, rather than leaving its absence to read as a refusal. */
const meetNote = (input: EventInput, event: RawEvent) => {
  if (!input.meet) return {};
  if (meetPending(event)) return { meetPending: "Google is still making the Meet link; get_event shows it in a moment" };
  if (meetFailed(event)) return { meetFailed: "the event was saved, but Google could not make its Meet link (this calendar may not allow Meet calls); update_event with meet: true tries again" };
  return {};
};

export const createEvent = async (deps: Deps, calendarId: string, input: EventInput, sendUpdates: SendUpdates) => {
  await requireWrite(deps);
  const body = eventBody(input, deps.timeZone, undefined, input.meet ? deps.newId() : undefined);
  const calendar = await calendarOf(deps, calendarId);
  // Google keeps focus time and out of office to the account's own calendar; say so before anything is sent.
  if (body["eventType"] !== undefined && !calendar.primary) {
    return fail(inputError(`${String(body["eventType"])} events go on the account's primary calendar only, not ${calendarId}`));
  }
  const made = await deps.calendar.insert(calendarId, body, sendUpdates);
  return {
    created: summarise(deps.account, calendar, made),
    ...meetNote(input, made),
    ...(input.attendees?.length ? { invited: input.attendees } : {}),
    notified: sendUpdates,
  };
};

/**
 * Only what the caller set is changed. The event is read first because a new
 * start with no end keeps the length the event already had, which is what
 * "move it to 11" means.
 */
export const updateEvent = async (deps: Deps, calendarId: string, eventId: string, input: EventInput, sendUpdates: SendUpdates, scope: Scope = "one") => {
  await requireWrite(deps);
  const existing = await deps.calendar.get(calendarId, eventId);
  checkScope(existing, scope, "change");
  const body = eventBody(input, deps.timeZone, existing, input.meet ? deps.newId() : undefined);
  if (Object.keys(body).length === 0) return { unchanged: true, reason: "no field to change was given" };
  const [calendar, updated] = await Promise.all([calendarOf(deps, calendarId), deps.calendar.patch(calendarId, eventId, body, sendUpdates)]);
  return {
    updated: summarise(deps.account, calendar, updated),
    ...meetNote(input, updated),
    changed: Object.keys(body),
    // A guest list given REPLACES the old one: say who that added and who it dropped.
    ...(input.attendees !== undefined ? { guests: guestChange(existing, input.attendees) } : {}),
    notified: sendUpdates,
  };
};

export const deleteEvent = async (deps: Deps, calendarId: string, eventId: string, sendUpdates: SendUpdates, scope: Scope = "one") => {
  await requireWrite(deps);
  // Read first, so the result says WHAT was deleted rather than an id nobody can check any more.
  const existing = await deps.calendar.get(calendarId, eventId);
  checkScope(existing, scope, "delete");
  await deps.calendar.remove(calendarId, eventId, sendUpdates);
  return { deleted: { account: deps.account, calendarId, eventId, title: existing.summary ?? "(no title)", start: existing.start?.dateTime ?? existing.start?.date }, notified: sendUpdates };
};

export const respondToInvite = async (deps: Deps, calendarId: string, eventId: string, response: Rsvp, sendUpdates: SendUpdates) => {
  await requireWrite(deps);
  const existing = await deps.calendar.get(calendarId, eventId);
  const attendees = withMyResponse(existing, response);
  const [calendar, updated] = await Promise.all([calendarOf(deps, calendarId), deps.calendar.respond(calendarId, eventId, attendees, sendUpdates)]);
  return { answered: response, event: summarise(deps.account, calendar, updated), notified: sendUpdates };
};
