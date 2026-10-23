import { z } from "zod";

import { FREEBUSY_MAX_IDS } from "../../app/ports.js";
import { MAX_BUSY_DAYS } from "../../app/usecases/busy.js";
import { findTime, freeBusy } from "../../app/usecases/freeBusy.js";
import { WEEKDAYS, type Weekday } from "../../domain/slots.js";
import { handled } from "../envelope.js";
import { type CalendarsArg, calendarsArg, readAccountArg, windowArgs } from "./args.js";
import type { Registrar } from "./types.js";

/** The window, accounts, calendars and attendees free_busy and find_time share, in the server's zone. */
const busyArgs = (zone: string) => ({
  ...windowArgs(MAX_BUSY_DAYS, zone),
  account: readAccountArg(),
  calendars: calendarsArg(),
  attendees: z
    .array(z.email())
    .max(FREEBUSY_MAX_IDS)
    .default([])
    .describe(
      "Other people's addresses whose free/busy an account may see (colleagues in the same organisation, anyone who shared their calendar). " +
        "Needs the calendar.events.freebusy scope; without it they are listed under `unknown` and the accounts' own calendars still count.",
    ),
});

type BusyArgs = { from: string; to: string; days: number; account: string; calendars: CalendarsArg; attendees: string[] };

const common = (a: BusyArgs) => ({ from: a.from, to: a.to, days: a.days, calendars: a.calendars, attendees: a.attendees });

export const registerFreeBusy: Registrar = (server, registry) => {
  server.registerTool(
    "free_busy",
    {
      title: "Free/busy",
      description:
        "When the user is busy across EVERY account in a window, per calendar, plus one merged, " +
        "de-duplicated `busy` timeline that also covers any `attendees`. Busy means: not cancelled, not \"show as available\", " +
        "not declined; tentative events and \"maybe\" answers count as busy and are flagged `tentative`; an all-day " +
        "event left as busy blocks its whole day. Anything that could not be read is listed under `unknown` and `complete` is false.",
      inputSchema: busyArgs(registry.timeZone),
    },
    handled(async (a: BusyArgs) => freeBusy(registry.select(a.account), common(a))),
  );

  server.registerTool(
    "find_time",
    {
      title: "Find time",
      description:
        "Candidate slots of `duration_minutes` across EVERY account (and optional `attendees`), inside working hours " +
        `(default Mon-Fri 09:00-18:00 ${registry.timeZone}), after a minimum notice, clear of existing events plus buffers, on a ` +
        "step grid, ranked earliest first or with mornings/afternoons first. Returns `slots` (overlapping candidates, e.g. 09:00 " +
        "and 09:30 for an hour) and `ranges` (the free stretches they come from). Tentative events block time unless " +
        "`tentative_is_free`. If some busy time could not be read, `complete` is false and `unknown` says what.",
      inputSchema: {
        duration_minutes: z.number().int().min(5).max(720).describe("Meeting length."),
        ...busyArgs(registry.timeZone),
        working_days: z
          .array(z.enum(WEEKDAYS))
          .min(1)
          .default(["mon", "tue", "wed", "thu", "fri"])
          .describe("Days a slot may fall on, in the working-hours zone."),
        hours_start: z.string().default("09:00").describe("Working hours start, HH:MM local."),
        hours_end: z.string().default("18:00").describe("Working hours end, HH:MM local, exclusive; 24:00 is midnight. After hours_start."),
        time_zone: z.string().default("").describe(`IANA zone for the working hours, the window and the answer. Empty means the server's zone (${registry.timeZone}).`),
        min_notice_minutes: z.number().int().min(0).max(20_160).default(60).describe("No slot starts sooner than this from now."),
        buffer_before_minutes: z.number().int().min(0).max(240).default(0).describe("Free time kept before each existing event."),
        buffer_after_minutes: z.number().int().min(0).max(240).default(0).describe("Free time kept after each existing event."),
        step_minutes: z.number().int().min(5).max(240).default(30).describe("Slots start on this grid from hours_start: 30 gives :00 and :30."),
        prefer: z.enum(["earliest", "morning", "afternoon"]).default("earliest").describe("Rank: earliest first, or that half of the day (before/after 12:00 local) first."),
        max_results: z.number().int().min(1).max(100).default(10),
        tentative_is_free: z.boolean().default(false).describe("Offer slots over tentative events and \"maybe\" answers."),
      },
    },
    handled(
      async (
        a: BusyArgs & {
          duration_minutes: number;
          working_days: Weekday[];
          hours_start: string;
          hours_end: string;
          time_zone: string;
          min_notice_minutes: number;
          buffer_before_minutes: number;
          buffer_after_minutes: number;
          step_minutes: number;
          prefer: "earliest" | "morning" | "afternoon";
          max_results: number;
          tentative_is_free: boolean;
        },
      ) =>
        findTime(registry.select(a.account), {
          ...common(a),
          durationMinutes: a.duration_minutes,
          stepMinutes: a.step_minutes,
          minNoticeMinutes: a.min_notice_minutes,
          bufferBeforeMinutes: a.buffer_before_minutes,
          bufferAfterMinutes: a.buffer_after_minutes,
          workingDays: a.working_days,
          hoursStart: a.hours_start,
          hoursEnd: a.hours_end,
          timeZone: a.time_zone,
          prefer: a.prefer,
          limit: a.max_results,
          tentativeIsFree: a.tentative_is_free,
        }),
    ),
  );
};
