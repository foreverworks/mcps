import { z } from "zod";

import { AUTO_DECLINES, EVENT_KINDS } from "../../domain/events.js";

import { ALL_ACCOUNTS } from "../../infra/accounts.js";

/**
 * The inputs every tool shares, so their wording cannot drift between tools.
 */
export const readAccountArg = () =>
  z
    .string()
    .default(ALL_ACCOUNTS)
    .describe(`Which account: a label from list_accounts, or "${ALL_ACCOUNTS}" for every account at once (the default).`);

/** The arguments of every read over a window of time: agenda, free_busy, find_time. `zone` is the server's (CALENDAR_TIME_ZONE). */
export const windowArgs = (maxDays: number, zone: string) => ({
  from: z.string().default("").describe(`YYYY-MM-DD or a time. Empty means today (${zone}).`),
  to: z.string().default("").describe("Exclusive end. Empty means `days` after from."),
  days: z.number().int().min(1).max(maxDays).default(7).describe(`Window length when \`to\` is empty; at most ${maxDays}.`),
});

export const calendarsArg = () =>
  z
    .union([z.enum(["selected", "primary", "all"]), z.array(z.string())])
    .default("selected")
    .describe(`"selected" (what the Calendar app shows, the default), "primary" (each account's own calendar only), "all", or a list of calendar ids or names.`);

/** What zod hands a controller for calendarsArg. */
export type CalendarsArg = "selected" | "primary" | "all" | string[];

export const accountArg = () =>
  z.string().default("").describe("Which account: a label from list_accounts; empty means the default account.");

/**
 * A write never falls back to a default account. An event created in the wrong
 * account is an outward-facing mistake: its invitations go out under the wrong
 * identity. The caller names one.
 */
export const writeAccountArg = () =>
  z
    .string()
    .min(1)
    .refine((v) => v.trim() !== ALL_ACCOUNTS, `a write takes one account, not "${ALL_ACCOUNTS}"`)
    .describe("Which account this writes to: a label from list_accounts. Required; writes have no default.");

export const calendarArg = () =>
  z.string().default("primary").describe(`Calendar id, from list_calendars or from an agenda event's calendarId. "primary" is the account's own.`);

export const eventIdArg = () => z.string().min(1).describe("The eventId from agenda.");

/** How far a change reaches on a recurring event; a series id is refused without "series". */
export const scopeArg = () =>
  z
    .enum(["one", "series"])
    .default("one")
    .describe('"one" (the default): the event or the one occurrence the eventId names. "series": required when the eventId is a whole recurring series, which this then changes in every occurrence.');

/**
 * Nobody is emailed unless the caller asks. A test event, a moved gym slot or
 * a note to self must not reach anyone's inbox; an invitation to a real meeting
 * says "all" on purpose.
 */
export const sendUpdatesArg = () =>
  z
    .enum(["none", "all", "externalOnly"])
    .default("none")
    .describe(`Who is emailed about this change: "none" (the default), "all" guests, or "externalOnly" (guests outside the domain).`);

/** The fields of an event a write sets; `zone` is the server's (CALENDAR_TIME_ZONE). */
export const eventFields = (zone: string) => ({
  title: z.string().optional().describe("The event's title."),
  start: z
    .string()
    .optional()
    .describe(`YYYY-MM-DD for an all-day event, YYYY-MM-DDTHH:MM for a time in the server's zone (${zone}), or RFC 3339 with an offset.`),
  end: z.string().optional().describe("Same forms as start, and the same kind. All-day ends are EXCLUSIVE: a one-day event on the 29th ends on the 30th. Omit to use duration_minutes."),
  duration_minutes: z.number().int().positive().optional().describe("Length when end is omitted. Default: an hour for a new event; on an update, the length it already had."),
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional().describe("Guest email addresses. On an update this REPLACES the guest list; the result lists who that added and removed."),
  reminders_minutes: z.array(z.number().int().min(0)).optional().describe("Popup reminders, in minutes before the start, replacing the calendar's defaults. [] means none."),
  busy: z.boolean().optional().describe("Whether it blocks time (\"show as busy\"). Default true."),
  recurrence: z
    .array(z.string())
    .optional()
    .describe('Repeat rule as RFC 5545 lines: ["RRULE:FREQ=YEARLY"] for a birthday, ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"] for a gym slot. On an update of a series this REPLACES the rule; [] stops it repeating.'),
  meet: z.boolean().optional().describe("true: Google makes a new Meet call for the event, and the result carries its link (meetingUrl). On an update, adds one to an event that has none."),
  auto_decline: z
    .enum(AUTO_DECLINES)
    .optional()
    .describe('Focus time and out of office only: which invitations Calendar declines while it lasts. "none" (the default), "new" (only those that arrive meanwhile) or "all" (every conflicting one, accepted ones too). Each decline is mail to that organiser.'),
  decline_message: z.string().optional().describe("Focus time and out of office only: the note a decline carries."),
  chat_status: z.enum(["available", "doNotDisturb"]).optional().describe("Focus time only: the status Google Chat shows meanwhile."),
});

/** create_event's own field: what kind of event it is, fixed once it exists. */
export const eventTypeArg = () =>
  z
    .enum(EVENT_KINDS)
    .default("default")
    .describe(
      '"default" (an appointment), "focusTime" or "outOfOffice". The last two go on the primary calendar, need a start and an end with times ' +
        "(never all day), take no guests or Meet link, and always block their time; Google offers them to Workspace accounts and refuses them elsewhere.",
    );

export type EventArgs = {
  title?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  duration_minutes?: number | undefined;
  location?: string | undefined;
  description?: string | undefined;
  attendees?: string[] | undefined;
  reminders_minutes?: number[] | undefined;
  busy?: boolean | undefined;
  recurrence?: string[] | undefined;
  meet?: boolean | undefined;
  auto_decline?: (typeof AUTO_DECLINES)[number] | undefined;
  decline_message?: string | undefined;
  chat_status?: "available" | "doNotDisturb" | undefined;
};
