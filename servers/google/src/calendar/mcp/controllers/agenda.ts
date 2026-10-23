import { z } from "zod";

import { agenda, listCalendars } from "../../app/usecases/agenda.js";
import { handled } from "../envelope.js";
import { type CalendarsArg, calendarsArg, readAccountArg, windowArgs } from "./args.js";
import type { Registrar } from "./types.js";

export const registerAgenda: Registrar = (server, registry) => {
  server.registerTool(
    "agenda",
    {
      title: "Agenda",
      description:
        "Events across EVERY account at once, in time order, for a window: today and the next " +
        "days by default. Also returns `conflicts` (busy events that overlap, including across accounts, e.g. a work " +
        "meeting over a dentist appointment), `probableDuplicates` (one appointment booked into both accounts as " +
        "two events) and `pendingInvites` (invitations not yet answered). Recurring events " +
        "are expanded into their instances; an event seen through both accounts is listed once, with `alsoOn`. " +
        "Declined events are left out unless asked for. Each event carries the account, calendarId and eventId that " +
        "get_event, update_event, delete_event and respond_to_invite need. include_tasks adds `tasksDue`: the Google " +
        "Tasks not yet done that fall due on the window's days (a task has a due date, never a time).",
      inputSchema: {
        ...windowArgs(366, registry.timeZone),
        account: readAccountArg(),
        calendars: calendarsArg(),
        query: z.string().optional().describe("Free-text search over title, description, location and guests."),
        include_declined: z.boolean().default(false),
        include_tasks: z.boolean().default(false).describe("Also the open tasks due on these days, from the same accounts' Google Tasks."),
        limit: z.number().int().min(1).max(2500).default(250),
      },
    },
    handled(
      async (args: {
        from: string;
        to: string;
        days: number;
        account: string;
        calendars: CalendarsArg;
        query?: string | undefined;
        include_declined: boolean;
        include_tasks: boolean;
        limit: number;
      }) => {
        const result = await agenda(registry.select(args.account), {
          from: args.from,
          to: args.to,
          days: args.days,
          calendars: args.calendars,
          ...(args.query ? { query: args.query } : {}),
          includeDeclined: args.include_declined,
          limit: args.limit,
        });
        if (!args.include_tasks) return result;
        if (!registry.tasksDue) return { ...result, tasksDue: { error: "this server has no Google Tasks product" } };
        // The accounts the agenda actually read, so "" (the default account) means the same account for both.
        return { ...result, tasksDue: await registry.tasksDue(result.accounts, { timeMin: result.from, timeMax: result.to, timeZone: result.timeZone }) };
      },
    ),
  );

  server.registerTool(
    "list_calendars",
    {
      title: "List calendars",
      description:
        "Every calendar each account can see (its own, shared ones, subscriptions, holidays), with its id, the " +
        "account's access to it, and whether agenda reads it by default.",
      inputSchema: { account: readAccountArg() },
    },
    handled(async (args: { account: string }) => ({ accounts: await listCalendars(registry.select(args.account)) })),
  );
};
