import { fail, inputError } from "./errors.js";
import type { RawConferenceRecord, RawDocsDestination, RawParticipant, RawRecording, RawSmartNote, RawTranscript, RawTranscriptEntry } from "./schema.js";

/**
 * Meetings as Meet's REST API records them, and as this server hands them on.
 * Pure.
 *
 * A meeting is a conference record: one sitting in a Meet space, with the
 * transcripts, smart notes (Gemini's "take notes for me") and recordings made
 * during it. Meet keeps a record for 30 days after the meeting ends.
 */

/** A meeting code, the part of a Meet link after meet.google.com/: three groups of letters. */
const CODE = /^[a-z]+-[a-z]+-[a-z]+$/;

/** The meeting code in a code or a Meet link, checked, so it can go into a filter as it is. */
export const meetingCodeOf = (text: string): string => {
  const trimmed = text.trim().toLowerCase();
  const fromUrl = /^(?:https?:\/\/)?meet\.google\.com\/([a-z-]+)/.exec(trimmed)?.[1];
  const code = fromUrl ?? trimmed;
  if (!CODE.test(code)) return fail(inputError(`"${text}" is not a Meet link or meeting code (abc-defg-hij)`));
  return code;
};

/** The Meet code of a calendar event's call, from its conference data or its link; undefined when it has none. */
export const codeOfEvent = (event: {
  readonly hangoutLink?: string | null;
  readonly conferenceData?: { readonly conferenceId?: string | null; readonly conferenceSolution?: { readonly key?: { readonly type?: string | null } | null } | null } | null;
}): string | undefined => {
  const id = event.conferenceData?.conferenceSolution?.key?.type === "hangoutsMeet" ? event.conferenceData.conferenceId : undefined;
  if (id && CODE.test(id)) return id;
  const fromLink = event.hangoutLink ? /meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)/.exec(event.hangoutLink)?.[1] : undefined;
  return fromLink;
};

/** An hour either side: a meeting can open early and run late, and still be that occurrence. */
const SLACK_MS = 60 * 60 * 1000;

/**
 * The filter that finds the records of a meeting: by its code, and for one
 * occurrence of an event, by a start near the event's own; by start time alone
 * for a window.
 */
export const recordFilter = (spec: { readonly code?: string; readonly near?: { readonly start: number; readonly end: number }; readonly since?: number }): string => {
  const clauses = [
    ...(spec.code ? [`space.meeting_code = "${spec.code}"`] : []),
    ...(spec.near
      ? [`start_time>="${new Date(spec.near.start - SLACK_MS).toISOString()}"`, `start_time<="${new Date(spec.near.end + SLACK_MS).toISOString()}"`]
      : []),
    ...(spec.since !== undefined ? [`start_time>="${new Date(spec.since).toISOString()}"`] : []),
  ];
  return clauses.join(" AND ");
};

const docOf = (d: RawDocsDestination | null | undefined) =>
  d?.document ? { document: d.document, link: `https://docs.google.com/document/d/${d.document}/view` } : {};

const artifact = (a: RawTranscript | RawSmartNote) => ({
  name: a.name ?? "",
  state: a.state ?? "STATE_UNSPECIFIED",
  ...docOf(a.docsDestination),
});

const recordingView = (r: RawRecording) => ({
  name: r.name ?? "",
  state: r.state ?? "STATE_UNSPECIFIED",
  ...(r.driveDestination?.file ? { driveFileId: r.driveDestination.file } : {}),
  ...(r.driveDestination?.exportUri ? { link: r.driveDestination.exportUri } : {}),
});

export const meetingView = (
  account: string,
  record: RawConferenceRecord,
  parts: { readonly transcripts: readonly RawTranscript[]; readonly notes: readonly RawSmartNote[]; readonly recordings: readonly RawRecording[] },
) => ({
  account,
  conferenceRecord: record.name ?? "",
  ...(record.space ? { space: record.space } : {}),
  start: record.startTime ?? "",
  ...(record.endTime ? { end: record.endTime } : { ongoing: true }),
  ...(record.expireTime ? { recordsExpire: record.expireTime } : {}),
  transcripts: parts.transcripts.map(artifact),
  notes: parts.notes.map(artifact),
  recordings: parts.recordings.map(recordingView),
});

/** The conference record a transcript belongs to: the first two segments of its name. */
export const recordOfTranscript = (transcript: string): string => {
  const match = /^(conferenceRecords\/[^/]+)\/transcripts\/[^/]+$/.exec(transcript.trim());
  if (!match?.[1]) return fail(inputError(`"${transcript}" is not a transcript name (conferenceRecords/<id>/transcripts/<id>, from list_meetings)`));
  return match[1];
};

export const speakerOf = (p: RawParticipant): string =>
  p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? "Unknown speaker";

/**
 * Seconds since the transcript began, as H:MM:SS, so a line says where in the
 * meeting it was said; a transcript Google gave no start shows each line's own
 * instant instead, never a count that restarts.
 */
const elapsed = (from: number, at: string | null | undefined): string => {
  if (!Number.isFinite(from)) return at ?? "?";
  const ms = at ? Date.parse(at) - from : Number.NaN;
  if (!Number.isFinite(ms) || ms < 0) return "?:??:??";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** One line per entry: "[0:12:05] Ana Popescu: what was said". */
export const transcriptLines = (entries: readonly RawTranscriptEntry[], speakers: ReadonlyMap<string, string>, startedAt: number): readonly string[] =>
  entries.map((e) => `[${elapsed(startedAt, e.startTime)}] ${speakers.get(e.participant ?? "") ?? "Unknown speaker"}: ${(e.text ?? "").trim()}`);
