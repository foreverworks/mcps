import { describe, expect, it, vi } from "vitest";

import type { CalendarPort, Deps, FreeBusyQuery, Window } from "../../src/calendar/app/ports.js";
import { findTime, type FindTimeRequest, freeBusy } from "../../src/calendar/app/usecases/freeBusy.js";
import { checkHealth } from "../../src/calendar/app/usecases/health.js";
import { asAppError, type AppError, fail, notFoundError } from "../../src/calendar/domain/errors.js";
import type { RawCalendar, RawEvent } from "../../src/calendar/domain/events.js";
import { CALENDAR_EVENTS, CALENDAR_EVENTS_FREEBUSY, CALENDAR_LIST_READONLY } from "../../src/calendar/domain/grants.js";
import type { RawFreeBusyResponse } from "../../src/calendar/domain/schema.js";

/**
 * The use cases over plain-object calendars: which calendars are read, over
 * which window, and what an answer with a hole in it looks like.
 */

type FakeOptions = {
  readonly scopes?: readonly string[];
  readonly freeBusy?: (query: FreeBusyQuery) => RawFreeBusyResponse;
};

const makeAccount = (account: string, calendars: readonly RawCalendar[], events: Record<string, readonly RawEvent[]>, options: FakeOptions = {}) => {
  const reads: { calendarId: string; window: Window }[] = [];
  const asked: FreeBusyQuery[] = [];
  const refuse = async (): Promise<never> => {
    throw new Error("a read-only use case called a write");
  };
  const port: CalendarPort = {
    calendars: async () => calendars,
    primary: async () => calendars.find((c) => c.primary) as RawCalendar,
    events: async (calendarId, window) => {
      reads.push({ calendarId, window });
      const found = events[calendarId];
      if (!found) return fail(notFoundError(`calendar ${calendarId} is gone`));
      return found;
    },
    get: refuse,
    freeBusy: async (query) => {
      asked.push(query);
      return options.freeBusy ? options.freeBusy(query) : {};
    },
    insert: refuse,
    patch: refuse,
    remove: refuse,
    respond: refuse,
  };
  const deps: Deps = {
    account,
    timeZone: "Europe/Bucharest",
    calendar: port,
    grant: { credentials: `/creds/${account}.json`, scopes: async () => options.scopes ?? [CALENDAR_EVENTS, CALENDAR_LIST_READONLY] },
    now: () => Date.parse("2026-09-28T06:00:00Z"),
    newId: () => "req-1",
  };
  return { deps, reads, asked };
};

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  const thrown: unknown = await promise.then(
    (value) => {
      throw new Error(`expected a failure, got ${JSON.stringify(value)}`);
    },
    (e: unknown) => e,
  );
  const error = asAppError(thrown);
  if (error === undefined) throw thrown;
  return error;
};

const ev = (id: string, start: string, end: string, extra: Partial<RawEvent> = {}): RawEvent => ({
  id,
  iCalUID: `${id}@google.com`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

const mine: RawCalendar = { id: "me@example.com", summary: "Me", primary: true, timeZone: "Europe/Bucharest" };
const gym: RawCalendar = { id: "gym", summary: "Gym", selected: true };
const holidays: RawCalendar = { id: "holidays", summary: "Holidays", selected: false };
const work: RawCalendar = { id: "me@work.example", summary: "Work", primary: true, timeZone: "Europe/Bucharest" };

/** Thursday 2026-10-01 in both accounts. */
const thursday = () => {
  const personal = makeAccount("personal", [mine, gym, holidays], {
    "me@example.com": [
      ev("dentist", "2026-10-01T11:00:00+03:00", "2026-10-01T12:00:00+03:00"),
      ev("reminder", "2026-10-01T09:00:00+03:00", "2026-10-01T09:30:00+03:00", { transparency: "transparent" }),
      // Booked into both accounts: counted once in the merged timeline.
      ev("sync", "2026-10-01T14:00:00+03:00", "2026-10-01T15:00:00+03:00"),
    ],
    gym: [ev("gym", "2026-10-01T07:00:00+03:00", "2026-10-01T08:00:00+03:00")],
    holidays: [{ id: "h", start: { date: "2026-10-01" }, end: { date: "2026-10-02" } }],
  });
  const workAccount = makeAccount("work", [work], {
    "me@work.example": [
      ev("standup", "2026-10-01T10:00:00+03:00", "2026-10-01T10:30:00+03:00"),
      ev("sync", "2026-10-01T14:00:00+03:00", "2026-10-01T15:00:00+03:00"),
      ev("declined", "2026-10-01T12:00:00+03:00", "2026-10-01T13:00:00+03:00", { attendees: [{ email: "me@work.example", self: true, responseStatus: "declined" }] }),
      ev("maybe", "2026-10-01T16:00:00+03:00", "2026-10-01T17:00:00+03:00", { attendees: [{ email: "me@work.example", self: true, responseStatus: "tentative" }] }),
    ],
  });
  return { personal, work: workAccount };
};

const base = { from: "2026-10-01", to: "", days: 1, calendars: "selected" as const, attendees: [] as string[] };

describe("free_busy", () => {
  it("merges both accounts into one de-duplicated timeline, leaving out what does not block time", async () => {
    const { personal, work: w } = thursday();
    const result = await freeBusy([personal.deps, w.deps], base);
    expect(result.busy).toEqual([
      { start: "2026-10-01T07:00:00+03:00", end: "2026-10-01T08:00:00+03:00" },
      { start: "2026-10-01T10:00:00+03:00", end: "2026-10-01T10:30:00+03:00" },
      { start: "2026-10-01T11:00:00+03:00", end: "2026-10-01T12:00:00+03:00" },
      { start: "2026-10-01T14:00:00+03:00", end: "2026-10-01T15:00:00+03:00" },
      { start: "2026-10-01T16:00:00+03:00", end: "2026-10-01T17:00:00+03:00", tentative: true },
    ]);
    expect(result.complete).toBe(true);
    expect(result).not.toHaveProperty("unknown");
    expect(result.calendars.map((c) => `${c.account}/${c.calendar}:${c.busy.length}`)).toEqual(["personal/Me:2", "personal/Gym:1", "work/Work:3"]);
  });

  it("reads each account's selected calendars over the window, and never the hidden ones", async () => {
    const { personal, work: w } = thursday();
    await freeBusy([personal.deps, w.deps], base);
    expect(personal.reads.map((r) => r.calendarId).sort()).toEqual(["gym", "me@example.com"]);
    expect(personal.reads[0]?.window).toMatchObject({ timeMin: "2026-10-01T00:00:00+03:00", timeMax: "2026-10-02T00:00:00+03:00" });
  });

  it("clips an all-day busy block to the window and flags it", async () => {
    const { personal } = thursday();
    const result = await freeBusy([personal.deps], { ...base, from: "2026-10-01T12:00", calendars: ["holidays"] });
    expect(result.calendars[0]?.busy).toEqual([{ start: "2026-10-01T12:00:00+03:00", end: "2026-10-02T00:00:00+03:00", allDay: true }]);
  });

  it("lists a calendar it could not read, and keeps every other answer", async () => {
    const dead = makeAccount("work", [work, { id: "team", summary: "Team", selected: true }], { "me@work.example": [] });
    const { personal } = thursday();
    const result = await freeBusy([personal.deps, dead.deps], base);
    expect(result.complete).toBe(false);
    expect(result.unknown).toEqual([{ account: "work", calendar: "Team", error: expect.stringContaining("calendar team is gone") }]);
    expect(result.busy.length).toBeGreaterThan(0);
  });

  it("reports busy events it could not place instead of dropping them", async () => {
    const broken = makeAccount("personal", [mine], { "me@example.com": [{ id: "no-end", start: { dateTime: "2026-10-01T10:00:00+03:00" } }] });
    const result = await freeBusy([broken.deps], base);
    expect(result.unknown).toEqual([{ account: "personal", calendar: "Me", error: expect.stringContaining("1 busy event(s)") }]);
  });

  it("names a calendar id that no account lists", async () => {
    const { personal, work: w } = thursday();
    const result = await freeBusy([personal.deps, w.deps], { ...base, calendars: ["gym", "no-such-calendar"] });
    expect(result.unknown).toEqual([{ calendar: "no-such-calendar", error: expect.stringContaining("list_calendars") }]);
  });

  it("refuses a window longer than two months before reading anything", async () => {
    const { personal } = thursday();
    expect((await failure(freeBusy([personal.deps], { ...base, days: 63 }))).kind).toBe("input");
    expect((await failure(freeBusy([personal.deps], { ...base, to: "2026-12-15" }))).message).toMatch(/62 days/);
    expect(personal.reads).toEqual([]);
  });
});

describe("free_busy with attendees", () => {
  const ana = "ana@work.example";
  const ext = "someone@elsewhere.example";

  it("refuses attendees per account when the grant lacks calendar.events.freebusy, and still reads the account's own calendars", async () => {
    const { personal, work: w } = thursday();
    const result = await freeBusy([personal.deps, w.deps], { ...base, attendees: [ana] });
    expect(personal.asked).toEqual([]);
    expect(w.asked).toEqual([]);
    expect(result.attendees).toEqual([{ email: ana, unknown: true, reasons: ["no account could be asked; see the account errors"] }]);
    expect(result.unknown).toEqual([
      { account: "personal", error: expect.stringContaining("calendar.events.freebusy") },
      { account: "work", error: expect.stringContaining("calendar.events.freebusy") },
      { attendee: ana, error: expect.any(String) },
    ]);
    expect(result.unknown?.[0]?.error).toMatch(/begin_consent \(product calendar/);
    expect(result.busy.length).toBe(5);
  });

  it("counts an attendee as known when any account can see them, and adds their time to the timeline", async () => {
    const personal = makeAccount("personal", [mine], { "me@example.com": [] }, {
      scopes: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY],
      freeBusy: () => ({ calendars: { [ana]: { errors: [{ domain: "global", reason: "notFound" }] } } }),
    });
    const w = makeAccount("work", [work], { "me@work.example": [] }, {
      scopes: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY],
      freeBusy: () => ({ calendars: { [ana]: { busy: [{ start: "2026-10-01T07:00:00Z", end: "2026-10-01T08:00:00Z" }] } } }),
    });
    const result = await freeBusy([personal.deps, w.deps], { ...base, attendees: [ana] });
    expect(w.asked).toEqual([{ timeMin: "2026-10-01T00:00:00+03:00", timeMax: "2026-10-02T00:00:00+03:00", ids: [ana] }]);
    expect(result.attendees).toEqual([{ email: ana, seenBy: ["work"], busy: [{ start: "2026-10-01T10:00:00+03:00", end: "2026-10-01T11:00:00+03:00" }] }]);
    expect(result.busy).toEqual([{ start: "2026-10-01T10:00:00+03:00", end: "2026-10-01T11:00:00+03:00" }]);
    expect(result.complete).toBe(true);
  });

  it("does not hold one account's missing scope against an attendee another account answered for", async () => {
    const personal = makeAccount("personal", [mine], { "me@example.com": [] });
    const w = makeAccount("work", [work], { "me@work.example": [] }, {
      scopes: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY],
      freeBusy: () => ({ calendars: { [ana]: {} } }),
    });
    const result = await freeBusy([personal.deps, w.deps], { ...base, attendees: [ana] });
    expect(result.complete).toBe(true);
  });

  it("lists an attendee nobody can see with every account's reason", async () => {
    const scopes = [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY];
    const notFound = () => ({ calendars: { [ext]: { errors: [{ domain: "global", reason: "notFound" }] } } });
    const personal = makeAccount("personal", [mine], { "me@example.com": [] }, { scopes, freeBusy: notFound });
    const w = makeAccount("work", [work], { "me@work.example": [] }, { scopes, freeBusy: notFound });
    const result = await freeBusy([personal.deps, w.deps], { ...base, attendees: [ext] });
    expect(result.attendees?.[0]).toMatchObject({ email: ext, unknown: true, reasons: [expect.stringMatching(/^personal: not visible/), expect.stringMatching(/^work: not visible/)] });
    expect(result.complete).toBe(false);
  });
});

const findRequest = (over: Partial<FindTimeRequest> = {}): FindTimeRequest => ({
  ...base,
  durationMinutes: 60,
  stepMinutes: 30,
  minNoticeMinutes: 60,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  workingDays: ["mon", "tue", "wed", "thu", "fri"],
  hoursStart: "09:00",
  hoursEnd: "18:00",
  timeZone: "",
  prefer: "earliest",
  limit: 10,
  tentativeIsFree: false,
  ...over,
});

describe("find_time", () => {
  it("finds the hours both accounts leave free, in the server's zone", async () => {
    const { personal, work: w } = thursday();
    const result = await findTime([personal.deps, w.deps], findRequest());
    expect(result.slots.map((s) => s.start)).toEqual([
      "2026-10-01T09:00:00+03:00",
      "2026-10-01T12:00:00+03:00",
      "2026-10-01T12:30:00+03:00",
      "2026-10-01T13:00:00+03:00",
      "2026-10-01T15:00:00+03:00",
      "2026-10-01T17:00:00+03:00",
    ]);
    // 10:30-11:00 is free but too short, so it is not a range.
    expect(result.ranges).toEqual([
      { start: "2026-10-01T09:00:00+03:00", end: "2026-10-01T10:00:00+03:00", minutes: 60 },
      { start: "2026-10-01T12:00:00+03:00", end: "2026-10-01T14:00:00+03:00", minutes: 120 },
      { start: "2026-10-01T15:00:00+03:00", end: "2026-10-01T16:00:00+03:00", minutes: 60 },
      { start: "2026-10-01T17:00:00+03:00", end: "2026-10-01T18:00:00+03:00", minutes: 60 },
    ]);
    expect(result.complete).toBe(true);
    expect(result).not.toHaveProperty("hint");
  });

  it("books over a tentative block only when told to", async () => {
    const { personal, work: w } = thursday();
    const firm = await findTime([personal.deps, w.deps], findRequest());
    const loose = await findTime([personal.deps, w.deps], findRequest({ tentativeIsFree: true }));
    expect(firm.slots.map((s) => s.start)).not.toContain("2026-10-01T16:00:00+03:00");
    expect(loose.slots.map((s) => s.start)).toContain("2026-10-01T16:00:00+03:00");
  });

  it("reads events beyond the window by the buffers, so an early meeting's buffer still counts", async () => {
    const { personal } = thursday();
    await findTime([personal.deps], findRequest({ bufferBeforeMinutes: 10, bufferAfterMinutes: 15 }));
    expect(personal.reads[0]?.window).toMatchObject({ timeMin: "2026-09-30T20:45:00.000Z", timeMax: "2026-10-01T21:10:00.000Z" });
  });

  it("warns that the slots may clash when some busy time could not be read", async () => {
    const dead = makeAccount("work", [work], {});
    const { personal } = thursday();
    const result = await findTime([personal.deps, dead.deps], findRequest());
    expect(result.complete).toBe(false);
    expect(result.warning).toMatch(/may clash/);
    expect(result.slots.length).toBeGreaterThan(0);
  });

  it("says why when nothing fits", async () => {
    const { personal, work: w } = thursday();
    const result = await findTime([personal.deps, w.deps], findRequest({ durationMinutes: 180 }));
    expect(result.slots).toEqual([]);
    expect(result.hint).toMatch(/no slot fits/);
  });

  it("works in another zone when asked, and refuses one that does not exist", async () => {
    const { personal } = thursday();
    const london = await findTime([personal.deps], findRequest({ timeZone: "Europe/London", hoursStart: "08:00", hoursEnd: "10:00", stepMinutes: 60 }));
    expect(london.timeZone).toBe("Europe/London");
    // 08:00 in London is 10:00 in Bucharest, free; 09:00 is 11:00, the dentist.
    expect(london.slots.map((s) => s.start)).toEqual(["2026-10-01T08:00:00+01:00"]);
    expect(london.from).toBe("2026-10-01T00:00:00+01:00");
    expect((await failure(findTime([personal.deps], findRequest({ timeZone: "Nowhere/Special" })))).kind).toBe("input");
  });

  it("refuses impossible working hours before reading anything", async () => {
    const { personal } = thursday();
    expect((await failure(findTime([personal.deps], findRequest({ hoursStart: "18:00", hoursEnd: "09:00" })))).kind).toBe("input");
    expect(personal.reads).toEqual([]);
  });

  it("does not suggest a time sooner than the notice", async () => {
    const { personal } = thursday();
    const soon: Deps = { ...personal.deps, now: () => Date.parse("2026-10-01T12:40:00+03:00") };
    const result = await findTime([soon], findRequest({ minNoticeMinutes: 30, durationMinutes: 30 }));
    expect(result.slots[0]?.start).toBe("2026-10-01T13:30:00+03:00");
  });
});

describe("health and the attendee scope", () => {
  it("reports whether attendees can be read, without failing a grant that cannot", async () => {
    const plain = makeAccount("personal", [mine], {});
    const wide = makeAccount("work", [work], {}, { scopes: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY] });
    const a = await checkHealth(plain.deps);
    expect(a).toMatchObject({ ok: true, canReadAttendeeFreeBusy: false });
    expect(await checkHealth(wide.deps)).toMatchObject({ ok: true, canReadAttendeeFreeBusy: true });
  });
});

describe("the freeBusy adapter", () => {
  it("posts one query with every id and reads the answer, retrying like a read", async () => {
    const { makeCalendarApi } = await import("../../src/calendar/infra/calendarApi.js");
    const { makeRequest } = await import("../../src/infra/httpJson.js");
    let calls = 0;
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => {
      calls += 1;
      return calls === 1
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ calendars: { "ana@work.example": { busy: [] } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", spy);
    try {
      const api = makeCalendarApi(makeRequest({ get: async () => "t", force: async () => "t" }, { sleep: async () => undefined }));
      const answer = await api.freeBusy({ timeMin: "2026-10-01T00:00:00+03:00", timeMax: "2026-10-02T00:00:00+03:00", ids: ["ana@work.example", "team@work.example"] });
      expect(answer).toEqual({ calendars: { "ana@work.example": { busy: [] } } });
      expect(spy).toHaveBeenCalledTimes(2);
      const [url, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        timeMin: "2026-10-01T00:00:00+03:00",
        timeMax: "2026-10-02T00:00:00+03:00",
        items: [{ id: "ana@work.example" }, { id: "team@work.example" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
