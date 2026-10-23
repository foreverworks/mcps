import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readAccountArg } from "../../grants/args.js";
import { DEFAULT_MAX_CHARS, listMeetings, MAX_DAYS, readTranscript } from "../app/usecases.js";
import type { Registry } from "../composition.js";
import { fail, inputError } from "../domain/errors.js";
import { handled } from "./envelope.js";

export const registerAll = (server: McpServer, registry: Registry): void => {
  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description:
        "The Google Meet meetings one account took part in, each with its transcripts, smart notes (Gemini's notes) and " +
        "recordings, as Meet records them: for a calendar event (event_id from agenda: its Meet call, and for one " +
        "occurrence the sitting that started within an hour of it), for a Meet link or code (meeting), or else for the " +
        `last days (at most ${MAX_DAYS}: Meet keeps records 30 days). A transcript or notes is a Google Doc: its document ` +
        "id opens with read_document; get_transcript reads a transcript as lines with who said what. Reading an event " +
        "needs the account's calendar grant too.",
      inputSchema: {
        account: readAccountArg("first"),
        event_id: z.string().optional().describe("An event's eventId from agenda, in this account's calendar."),
        calendar_id: z.string().default("primary").describe("The event's calendarId, with event_id."),
        meeting: z.string().optional().describe("A Meet link (https://meet.google.com/abc-defg-hij) or its code."),
        days: z.number().int().min(1).max(MAX_DAYS).default(7).describe("Without event_id or meeting: how many days back."),
        limit: z.number().int().min(1).max(50).default(10).describe("The newest meetings, at most."),
      },
    },
    handled((a: { account: string; event_id?: string | undefined; calendar_id: string; meeting?: string | undefined; days: number; limit: number }) => {
      if (a.event_id && a.meeting) return fail(inputError("give event_id or meeting, not both"));
      const deps = registry.get(a.account);
      if (a.event_id) return listMeetings(deps, { by: "event", calendarId: a.calendar_id, eventId: a.event_id, limit: a.limit });
      if (a.meeting) return listMeetings(deps, { by: "meeting", meeting: a.meeting, limit: a.limit });
      return listMeetings(deps, { by: "window", days: a.days, limit: a.limit });
    }),
  );

  server.registerTool(
    "get_transcript",
    {
      title: "Get transcript",
      description:
        "A Meet transcript as text, one line per thing said: \"[0:12:05] Ana Popescu: ...\", the time counted from when " +
        "the transcript began. Long ones come in parts of about max_chars; pass nextPageToken back to read on. The " +
        "transcript is the name list_meetings gives (conferenceRecords/.../transcripts/...).",
      inputSchema: {
        account: readAccountArg("first"),
        transcript: z.string().min(1).describe("The transcript's name, from list_meetings."),
        page_token: z.string().optional().describe("nextPageToken from the previous part."),
        max_chars: z.number().int().min(1000).max(200_000).default(DEFAULT_MAX_CHARS),
      },
    },
    handled((a: { account: string; transcript: string; page_token?: string | undefined; max_chars: number }) =>
      readTranscript(registry.get(a.account), { transcript: a.transcript, ...(a.page_token ? { pageToken: a.page_token } : {}), maxChars: a.max_chars }),
    ),
  );
};
