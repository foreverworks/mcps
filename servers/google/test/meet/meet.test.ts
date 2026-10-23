/** Meet's records and transcripts against a fake port and a recording request layer. Invented data only. */
import { describe, expect, it } from "vitest";

import type { Deps, EventOfMeeting, MeetPort } from "../../src/meet/app/ports.js";
import { listMeetings, readTranscript } from "../../src/meet/app/usecases.js";
import { asAppError } from "../../src/meet/domain/errors.js";
import { codeOfEvent, meetingCodeOf, recordFilter } from "../../src/meet/domain/meetings.js";
import type { RawTranscriptEntry } from "../../src/meet/domain/schema.js";
import { makeMeetApi } from "../../src/meet/infra/meetApi.js";
import type { Request, RequestSpec } from "../../src/infra/httpJson.js";

const RECORD = "conferenceRecords/rec-1";
const TRANSCRIPT = `${RECORD}/transcripts/tr-1`;

const entry = (n: number, who: string, text: string, at: string): RawTranscriptEntry => ({ name: `${TRANSCRIPT}/entries/${n}`, participant: `${RECORD}/participants/${who}`, text, startTime: at });

const fakeMeet = (pages: readonly (readonly RawTranscriptEntry[])[] = []) => {
  const filters: string[] = [];
  const meet: MeetPort = {
    records: async (filter) => (filters.push(filter), [{ name: RECORD, startTime: "2026-10-20T09:02:00Z", endTime: "2026-10-20T09:40:00Z", space: "spaces/sp-1" }]),
    transcripts: async () => [{ name: TRANSCRIPT, state: "FILE_GENERATED", docsDestination: { document: "doc-tr-1" } }],
    transcript: async () => ({ name: TRANSCRIPT, state: "FILE_GENERATED", startTime: "2026-10-20T09:03:00Z", docsDestination: { document: "doc-tr-1" } }),
    notes: async () => [{ name: `${RECORD}/smartNotes/sn-1`, state: "FILE_GENERATED", docsDestination: { document: "doc-notes-1" } }],
    recordings: async () => [],
    participants: async () => [
      { name: `${RECORD}/participants/p1`, signedinUser: { displayName: "Ana Popescu" } },
      { name: `${RECORD}/participants/p2`, phoneUser: { displayName: "Phone caller" } },
    ],
    entries: async (_t, token) => {
      const i = token ? Number(token) : 0;
      return { entries: pages[i] ?? [], ...(i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {}) };
    },
    probe: async () => ({}),
  };
  return { meet, filters };
};

const depsWith = (meet: MeetPort, event: EventOfMeeting = { title: "Weekly sync", code: "abc-defg-hij", start: Date.parse("2026-10-20T09:00:00Z"), end: Date.parse("2026-10-20T09:30:00Z") }): Deps => ({
  grant: { account: "work", credentials: "/creds/work.json", scopes: async () => [], whoami: async () => "ana@example.org" },
  meet,
  eventOf: async () => event,
  now: () => Date.parse("2026-10-22T12:00:00Z"),
});

describe("meeting codes and filters", () => {
  it("takes a code or a link, and refuses anything that could change the filter", () => {
    expect(meetingCodeOf("https://meet.google.com/abc-defg-hij?authuser=1")).toBe("abc-defg-hij");
    expect(meetingCodeOf(" ABC-defg-hij ")).toBe("abc-defg-hij");
    expect(() => meetingCodeOf('abc" OR start_time>"0')).toThrow();
  });

  it("finds an event's code in its conference data or its link", () => {
    expect(codeOfEvent({ conferenceData: { conferenceId: "abc-defg-hij", conferenceSolution: { key: { type: "hangoutsMeet" } } } })).toBe("abc-defg-hij");
    expect(codeOfEvent({ hangoutLink: "https://meet.google.com/xyz-abcd-efg" })).toBe("xyz-abcd-efg");
    expect(codeOfEvent({ conferenceData: { conferenceId: "123456", conferenceSolution: { key: { type: "addOn" } } } })).toBeUndefined();
  });

  it("narrows an occurrence to the sitting that started within an hour of it", () => {
    expect(recordFilter({ code: "abc-defg-hij", near: { start: Date.parse("2026-10-20T09:00:00Z"), end: Date.parse("2026-10-20T09:30:00Z") } })).toBe(
      'space.meeting_code = "abc-defg-hij" AND start_time>="2026-10-20T08:00:00.000Z" AND start_time<="2026-10-20T10:30:00.000Z"',
    );
  });
});

describe("listMeetings", () => {
  it("finds an event's meeting with its transcript and notes as Docs to open", async () => {
    const { meet, filters } = fakeMeet();
    const out = await listMeetings(depsWith(meet), { by: "event", calendarId: "primary", eventId: "ev1", limit: 10 });
    expect(filters[0]).toContain('space.meeting_code = "abc-defg-hij"');
    expect(out).toMatchObject({
      account: "work",
      event: "Weekly sync",
      meetings: [
        {
          conferenceRecord: RECORD,
          start: "2026-10-20T09:02:00Z",
          end: "2026-10-20T09:40:00Z",
          transcripts: [{ name: TRANSCRIPT, state: "FILE_GENERATED", document: "doc-tr-1", link: "https://docs.google.com/document/d/doc-tr-1/view" }],
          notes: [{ document: "doc-notes-1" }],
          recordings: [],
        },
      ],
    });
  });

  it("refuses an event without a Meet call before asking Meet", async () => {
    const { meet, filters } = fakeMeet();
    const thrown: unknown = await listMeetings(depsWith(meet, { title: "Dentist" }), { by: "event", calendarId: "primary", eventId: "ev2", limit: 10 }).catch((t: unknown) => t);
    expect(asAppError(thrown)).toMatchObject({ kind: "input" });
    expect(filters).toEqual([]);
  });

  it("reads the last days by start time", async () => {
    const { meet, filters } = fakeMeet();
    await listMeetings(depsWith(meet), { by: "window", days: 2, limit: 10 });
    expect(filters).toEqual(['start_time>="2026-10-20T12:00:00.000Z"']);
  });
});

describe("readTranscript", () => {
  const pages = [
    [entry(1, "p1", "Shall we start?", "2026-10-20T09:03:05Z"), entry(2, "p2", "Yes.", "2026-10-20T09:03:09Z")],
    [entry(3, "p1", "Next item is the budget.", "2026-10-20T10:15:00Z")],
  ];

  it("writes who said what and when in the meeting, reading whole pages", async () => {
    const out = await readTranscript(depsWith(fakeMeet(pages).meet), { transcript: TRANSCRIPT, maxChars: 40_000 });
    expect(out.text).toBe("[0:00:05] Ana Popescu: Shall we start?\n[0:00:09] Phone caller: Yes.\n[1:12:00] Ana Popescu: Next item is the budget.");
    expect(out).toMatchObject({ lines: 3, document: "doc-tr-1", speakers: ["Ana Popescu", "Phone caller"] });
    expect(out).not.toHaveProperty("nextPageToken");
  });

  it("stops at a page boundary once max_chars is reached, with the token to read on", async () => {
    const first = await readTranscript(depsWith(fakeMeet(pages).meet), { transcript: TRANSCRIPT, maxChars: 10 });
    expect(first).toMatchObject({ lines: 2, nextPageToken: "1" });
    const rest = await readTranscript(depsWith(fakeMeet(pages).meet), { transcript: TRANSCRIPT, pageToken: "1", maxChars: 10 });
    expect(rest.text).toBe("[1:12:00] Ana Popescu: Next item is the budget.");
  });

  it("shows each line's own time when Google gave the transcript no start, never a count that restarts", async () => {
    const { meet } = fakeMeet(pages);
    const noStart: MeetPort = { ...meet, transcript: async () => ({ name: TRANSCRIPT, state: "ENDED" }) };
    const out = await readTranscript(depsWith(noStart), { transcript: TRANSCRIPT, pageToken: "1", maxChars: 1000 });
    expect(out.text).toBe("[2026-10-20T10:15:00Z] Ana Popescu: Next item is the budget.");
  });

  it("refuses a name that is not a transcript's", async () => {
    const thrown: unknown = await readTranscript(depsWith(fakeMeet().meet), { transcript: "spaces/x", maxChars: 1000 }).catch((t: unknown) => t);
    expect(asAppError(thrown)).toMatchObject({ kind: "input" });
  });
});

describe("the Meet adapter", () => {
  it("encodes each segment of a resource name and pages a list", async () => {
    const calls: { url: string; spec: RequestSpec }[] = [];
    let n = 0;
    const request = (async (url: string, spec: RequestSpec = {}) => {
      calls.push({ url, spec });
      n += 1;
      return n === 1 ? { participants: [{ name: "a" }], nextPageToken: "next" } : { participants: [{ name: "b" }] };
    }) as unknown as Request;
    const people = await makeMeetApi(request).participants("conferenceRecords/r 1");
    expect(people.map((p) => p.name)).toEqual(["a", "b"]);
    expect(calls[0]?.url).toBe("https://meet.googleapis.com/v2/conferenceRecords/r%201/participants");
    expect(calls[1]?.spec.query).toMatchObject({ pageToken: "next", pageSize: 100 });
  });
});
