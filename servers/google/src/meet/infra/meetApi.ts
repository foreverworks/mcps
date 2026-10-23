import type { Request } from "../../infra/httpJson.js";
import type { MeetPort } from "../app/ports.js";
import type { Page, RawConferenceRecord, RawParticipant, RawRecording, RawSmartNote, RawTranscript, RawTranscriptEntry } from "../domain/schema.js";

/** The only file that knows the Meet REST API's URLs and parameter names. */
const BASE = "https://meet.googleapis.com/v2";

/** Each list's documented page cap. */
const PAGE = 100;

/** A resource name's segments, each encoded, so a name can never reach another endpoint. */
const path = (name: string): string => name.split("/").map(encodeURIComponent).join("/");

export const makeMeetApi = (request: Request): MeetPort => {
  const all = async <K extends string, T>(url: string, key: K, query: Record<string, string | number | undefined> = {}, limit = Number.POSITIVE_INFINITY): Promise<readonly T[]> => {
    const items: T[] = [];
    let pageToken: string | undefined;
    do {
      const page = await request<Page<K, T>>(url, { query: { ...query, pageSize: Math.min(PAGE, limit), pageToken } });
      items.push(...((page[key] as readonly T[] | null | undefined) ?? []));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && items.length < limit);
    return items.slice(0, limit);
  };

  return {
    records: (filter, limit) => all<"conferenceRecords", RawConferenceRecord>(`${BASE}/conferenceRecords`, "conferenceRecords", { filter: filter || undefined }, limit),
    transcripts: (record) => all<"transcripts", RawTranscript>(`${BASE}/${path(record)}/transcripts`, "transcripts"),
    transcript: (name) => request<RawTranscript>(`${BASE}/${path(name)}`),
    notes: (record) => all<"smartNotes", RawSmartNote>(`${BASE}/${path(record)}/smartNotes`, "smartNotes"),
    recordings: (record) => all<"recordings", RawRecording>(`${BASE}/${path(record)}/recordings`, "recordings"),
    participants: (record) => all<"participants", RawParticipant>(`${BASE}/${path(record)}/participants`, "participants"),
    entries: async (transcript, pageToken) => {
      const page = await request<Page<"transcriptEntries", RawTranscriptEntry>>(`${BASE}/${path(transcript)}/entries`, { query: { pageSize: PAGE, pageToken } });
      return { entries: page.transcriptEntries ?? [], ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
    },
    probe: () => request<unknown>(`${BASE}/conferenceRecords`, { query: { pageSize: 1 } }),
  };
};
