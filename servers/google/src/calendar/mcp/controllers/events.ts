import { z } from "zod";

import type { SendUpdates } from "../../app/ports.js";
import { createEvent, deleteEvent, getEvent, respondToInvite, type Scope, updateEvent } from "../../app/usecases/events.js";
import type { EventInput, EventKind } from "../../domain/events.js";
import { handled } from "../envelope.js";
import { accountArg, calendarArg, type EventArgs, eventFields, eventIdArg, eventTypeArg, scopeArg, sendUpdatesArg, writeAccountArg } from "./args.js";
import type { Registrar } from "./types.js";

const eventInput = (a: EventArgs): EventInput => ({
  ...(a.title !== undefined ? { title: a.title } : {}),
  ...(a.start !== undefined ? { start: a.start } : {}),
  ...(a.end !== undefined ? { end: a.end } : {}),
  ...(a.duration_minutes !== undefined ? { durationMinutes: a.duration_minutes } : {}),
  ...(a.location !== undefined ? { location: a.location } : {}),
  ...(a.description !== undefined ? { description: a.description } : {}),
  ...(a.attendees !== undefined ? { attendees: a.attendees } : {}),
  ...(a.reminders_minutes !== undefined ? { remindersMinutes: a.reminders_minutes } : {}),
  ...(a.busy !== undefined ? { busy: a.busy } : {}),
  ...(a.recurrence !== undefined ? { recurrence: a.recurrence } : {}),
  ...(a.meet !== undefined ? { meet: a.meet } : {}),
  ...(a.auto_decline !== undefined ? { autoDecline: a.auto_decline } : {}),
  ...(a.decline_message !== undefined ? { declineMessage: a.decline_message } : {}),
  ...(a.chat_status !== undefined ? { chatStatus: a.chat_status } : {}),
});

type Target = { account: string; calendar_id: string; event_id: string };

export const registerEvents: Registrar = (server, registry) => {
  server.registerTool(
    "get_event",
    {
      title: "Get event",
      description: "One event in full: description, guest list with each answer, reminders, meeting link, recurrence.",
      inputSchema: { account: accountArg(), calendar_id: calendarArg(), event_id: eventIdArg() },
    },
    handled((a: Target) => getEvent(registry.get(a.account), a.calendar_id, a.event_id)),
  );

  server.registerTool(
    "create_event",
    {
      title: "Create event",
      description:
        "Add an event to one account's calendar. Needs title and start; a timed event with no end lasts an hour. " +
        `Times without an offset are in ${registry.timeZone}. Guests are NOT emailed unless send_updates says so. ` +
        "meet: true gives it a new Google Meet link. event_type makes focus time or an out of office block instead of an appointment (title optional for those).",
      inputSchema: {
        account: writeAccountArg(),
        calendar_id: calendarArg(),
        event_type: eventTypeArg(),
        ...eventFields(registry.timeZone),
        send_updates: sendUpdatesArg(),
      },
    },
    handled((a: EventArgs & { account: string; calendar_id: string; event_type: EventKind; send_updates: SendUpdates }) =>
      createEvent(registry.get(a.account), a.calendar_id, { ...eventInput(a), kind: a.event_type }, a.send_updates),
    ),
  );

  server.registerTool(
    "update_event",
    {
      title: "Update event",
      description:
        "Change an event. Only the fields given change; a new start with no end keeps the event's length. On a " +
        "recurring event, the eventId decides the reach: an instance id from agenda changes that one occurrence, and " +
        "a series id (every occurrence) is refused unless scope is \"series\". attendees replaces the guest list, " +
        "and the result says who that added and removed. Guests are NOT emailed unless send_updates says so. meet: true " +
        "adds a Meet link to an event without one. An event's type cannot change; a focus time or out of office event " +
        "takes new auto_decline, decline_message and chat_status.",
      inputSchema: {
        account: writeAccountArg(),
        calendar_id: calendarArg(),
        event_id: eventIdArg(),
        ...eventFields(registry.timeZone),
        send_updates: sendUpdatesArg(),
        scope: scopeArg(),
      },
    },
    handled((a: EventArgs & Target & { send_updates: SendUpdates; scope: Scope }) =>
      updateEvent(registry.get(a.account), a.calendar_id, a.event_id, eventInput(a), a.send_updates, a.scope),
    ),
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete event",
      description:
        "Delete an event (an instance id from agenda deletes that one occurrence; a series id, every occurrence, is " +
        "refused unless scope is \"series\"). On an event someone else organised this removes it from this calendar " +
        "only; to say no, use respond_to_invite with declined.",
      inputSchema: { account: writeAccountArg(), calendar_id: calendarArg(), event_id: eventIdArg(), send_updates: sendUpdatesArg(), scope: scopeArg() },
    },
    handled((a: Target & { send_updates: SendUpdates; scope: Scope }) =>
      deleteEvent(registry.get(a.account), a.calendar_id, a.event_id, a.send_updates, a.scope),
    ),
  );

  server.registerTool(
    "respond_to_invite",
    {
      title: "Respond to invite",
      description:
        "Answer an invitation: accepted, declined or tentative. Changes only your own answer. The organiser sees it " +
        "on the event either way; send_updates=all also emails them.",
      inputSchema: {
        account: writeAccountArg(),
        calendar_id: calendarArg(),
        event_id: eventIdArg(),
        response: z.enum(["accepted", "declined", "tentative"]),
        send_updates: sendUpdatesArg(),
      },
    },
    handled((a: Target & { response: "accepted" | "declined" | "tentative"; send_updates: SendUpdates }) =>
      respondToInvite(registry.get(a.account), a.calendar_id, a.event_id, a.response, a.send_updates),
    ),
  );
};
