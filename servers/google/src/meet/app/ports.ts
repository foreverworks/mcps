/** What the Meet use cases need, named as operations. No URL appears above infra/. */
import type { Grant } from "../../grants/grant.js";
import type { RawConferenceRecord, RawParticipant, RawRecording, RawSmartNote, RawTranscript, RawTranscriptEntry } from "../domain/schema.js";

export type MeetPort = {
  /** Conference records matching a filter, newest first, up to `limit`. */
  readonly records: (filter: string, limit: number) => Promise<readonly RawConferenceRecord[]>;
  readonly transcripts: (record: string) => Promise<readonly RawTranscript[]>;
  readonly transcript: (name: string) => Promise<RawTranscript>;
  readonly notes: (record: string) => Promise<readonly RawSmartNote[]>;
  readonly recordings: (record: string) => Promise<readonly RawRecording[]>;
  /** Everyone who joined, every page. */
  readonly participants: (record: string) => Promise<readonly RawParticipant[]>;
  /** One page of a transcript's entries, in the order spoken. */
  readonly entries: (transcript: string, pageToken: string | undefined) => Promise<{ readonly entries: readonly RawTranscriptEntry[]; readonly nextPageToken?: string }>;
  readonly probe: () => Promise<unknown>;
};

/** A calendar event, as far as finding its meeting goes. */
export type EventOfMeeting = {
  readonly title: string;
  /** The Meet code of its call, when it has one. */
  readonly code?: string;
  /** Epoch milliseconds of a timed occurrence; absent for an all-day event or a whole series. */
  readonly start?: number;
  readonly end?: number;
};

export type Deps = {
  readonly grant: Grant;
  readonly meet: MeetPort;
  /** Reads an event through the same account's calendar grant. */
  readonly eventOf: (calendarId: string, eventId: string) => Promise<EventOfMeeting>;
  readonly now: () => number;
};
