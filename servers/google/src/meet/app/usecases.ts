import { grantHealth } from "../../grants/health.js";
import { describeThrown, fail, inputError, remedyFor } from "../domain/errors.js";
import { REQUIRED_SCOPES } from "../domain/grants.js";
import { meetingCodeOf, meetingView, recordFilter, recordOfTranscript, speakerOf, transcriptLines } from "../domain/meetings.js";
import type { Deps } from "./ports.js";

const DAY_MS = 86_400_000;

/** Meet keeps a meeting's records for 30 days after it ends, so a window reaches no further back. */
export const MAX_DAYS = 30;

export type MeetingsRequest =
  | { readonly by: "event"; readonly calendarId: string; readonly eventId: string; readonly limit: number }
  | { readonly by: "meeting"; readonly meeting: string; readonly limit: number }
  | { readonly by: "window"; readonly days: number; readonly limit: number };

/** The filter the request comes to, and what it was found from. */
const filterOf = async (deps: Deps, request: MeetingsRequest) => {
  if (request.by === "meeting") {
    const code = meetingCodeOf(request.meeting);
    return { filter: recordFilter({ code }), from: { meetingCode: code } };
  }
  if (request.by === "window") {
    if (!(request.days >= 1 && request.days <= MAX_DAYS)) return fail(inputError(`days must be 1 to ${MAX_DAYS}: Meet keeps records for 30 days`));
    return { filter: recordFilter({ since: deps.now() - request.days * DAY_MS }), from: { lastDays: request.days } };
  }
  const event = await deps.eventOf(request.calendarId, request.eventId);
  if (!event.code) return fail(inputError(`"${event.title}" has no Google Meet call; only a Meet link has records here`));
  const near = event.start !== undefined && event.end !== undefined ? { start: event.start, end: event.end } : undefined;
  return { filter: recordFilter({ code: event.code, ...(near ? { near } : {}) }), from: { event: event.title, meetingCode: event.code } };
};

/**
 * The meetings an account took part in, each with its transcripts, smart
 * notes and recordings: those of one calendar event (its Meet code, and for
 * one occurrence, a start within an hour of the event's), of one Meet link,
 * or of the last days. A transcript and the notes are Google Docs: their ids
 * open with read_document, and get_transcript reads a transcript line by line
 * with who said what.
 */
export const listMeetings = async (deps: Deps, request: MeetingsRequest) => {
  const { filter, from } = await filterOf(deps, request);
  const records = await deps.meet.records(filter, request.limit);
  const meetings = await Promise.all(
    records.map(async (record) => {
      const name = record.name ?? "";
      const [transcripts, notes, recordings] = await Promise.all([deps.meet.transcripts(name), deps.meet.notes(name), deps.meet.recordings(name)]);
      return meetingView(deps.grant.account, record, { transcripts, notes, recordings });
    }),
  );
  return { account: deps.grant.account, ...from, meetings, ...(records.length === request.limit ? { truncated: `the newest ${request.limit}; raise limit for more` } : {}) };
};

/** About 10,000 words: what one read of a transcript returns before it offers the next page. */
export const DEFAULT_MAX_CHARS = 40_000;

/**
 * A transcript as text, one line per thing said, with who said it and when
 * in the meeting: "[0:12:05] Ana Popescu: ...". Read in whole pages until
 * `max_chars` is reached; `nextPageToken` reads on from there.
 */
export const readTranscript = async (deps: Deps, args: { readonly transcript: string; readonly pageToken?: string; readonly maxChars: number }) => {
  const record = recordOfTranscript(args.transcript);
  const [transcript, participants] = await Promise.all([deps.meet.transcript(args.transcript), deps.meet.participants(record)]);
  const speakers = new Map(participants.map((p) => [p.name ?? "", speakerOf(p)]));
  const startedAt = Date.parse(transcript.startTime ?? "");
  const lines: string[] = [];
  let size = 0;
  let pageToken = args.pageToken;
  do {
    const page = await deps.meet.entries(args.transcript, pageToken);
    const more = transcriptLines(page.entries, speakers, startedAt);
    lines.push(...more);
    size += more.reduce((n, line) => n + line.length + 1, 0);
    pageToken = page.nextPageToken;
  } while (pageToken && size < args.maxChars);
  return {
    account: deps.grant.account,
    transcript: args.transcript,
    state: transcript.state ?? "STATE_UNSPECIFIED",
    ...(transcript.docsDestination?.document ? { document: transcript.docsDestination.document } : {}),
    speakers: [...new Set(speakers.values())],
    lines: lines.length,
    text: lines.join("\n"),
    ...(pageToken ? { nextPageToken: pageToken } : {}),
  };
};

export const checkHealth = (deps: Deps) => grantHealth(deps.grant, { required: REQUIRED_SCOPES, probe: deps.meet.probe, remedyFor });

export { describeThrown };
