import { describe, expect, it } from "vitest";

import { asAppError, type AppError } from "../../src/calendar/domain/errors.js";
import {
  eventBody,
  findConflicts,
  mergeAgenda,
  pendingInvites,
  type RawCalendar,
  type RawEvent,
  summarise,
  withMyResponse,
} from "../../src/calendar/domain/events.js";
import { canReadAttendeeFreeBusy, missingScopes } from "../../src/calendar/domain/grants.js";
import {
  formatWithOffset,
  localMinutesToEpoch,
  mergeIntervals,
  offsetOfText,
  parseClockTime,
  parseWhen,
  subtractIntervals,
  todayIn,
  windowBound,
  windowOf,
  zonedToInstant,
} from "../../src/calendar/domain/time.js";

const TZ = "Europe/Bucharest";

const thrownBy = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    const error = asAppError(e);
    if (error) return error;
    throw e;
  }
  throw new Error("expected a failure");
};

describe("time", () => {
  it("reads a wall-clock time in Bucharest, with the offset of that date", () => {
    expect(zonedToInstant("2026-09-29", "10:00:00", TZ)).toBe("2026-09-29T10:00:00+03:00");
    expect(zonedToInstant("2026-12-01", "10:00:00", TZ)).toBe("2026-12-01T10:00:00+02:00");
  });

  // The two days a year a fixed offset would be wrong by an hour.
  it("follows the DST change on the day itself", () => {
    expect(zonedToInstant("2026-10-25", "09:00:00", TZ)).toBe("2026-10-25T09:00:00+02:00");
    expect(zonedToInstant("2026-03-29", "09:00:00", TZ)).toBe("2026-03-29T09:00:00+03:00");
  });

  it("tells a whole day, a local time and an instant apart", () => {
    expect(parseWhen("2026-09-29", TZ)).toEqual({ kind: "date", date: "2026-09-29" });
    expect(parseWhen("2026-09-29T18:30", TZ)).toEqual({ kind: "dateTime", dateTime: "2026-09-29T18:30:00+03:00" });
    expect(parseWhen("2026-09-29T15:30:00Z", TZ)).toEqual({ kind: "dateTime", dateTime: "2026-09-29T15:30:00Z" });
  });

  it("refuses what is not a time instead of guessing", () => {
    expect(thrownBy(() => parseWhen("tomorrow", TZ)).kind).toBe("input");
    expect(thrownBy(() => parseWhen("2026-02-30", TZ)).kind).toBe("input");
    expect(thrownBy(() => parseWhen("2026-09-29T25:00", TZ)).kind).toBe("input");
  });

  it("starts a day's window at local midnight, not UTC midnight", () => {
    expect(windowBound("2026-09-29", TZ)).toBe("2026-09-29T00:00:00+03:00");
  });

  // 22:30 UTC on the 28th is already the 29th in Bucharest.
  it("says what today is in the zone, not on the host", () => {
    expect(todayIn(TZ, Date.parse("2026-09-28T22:30:00Z"))).toBe("2026-09-29");
  });
});

const primary: RawCalendar = { id: "me@example.com", summary: "Me", primary: true };
const work: RawCalendar = { id: "me@work.example", summary: "Work", primary: true };

const ev = (id: string, start: string, end: string, extra: Partial<RawEvent> = {}): RawEvent => ({
  id,
  iCalUID: `${id}@google.com`,
  summary: id,
  start: start.length === 10 ? { date: start } : { dateTime: start },
  end: end.length === 10 ? { date: end } : { dateTime: end },
  ...extra,
});

describe("time: windows, clock times and intervals", () => {
  const i = (startMs: number, endMs: number) => ({ startMs, endMs });

  it("builds a window from days or an end, and refuses one longer than allowed", () => {
    expect(windowOf({ from: "2026-10-22", to: "", days: 7 }, TZ, 0, 62)).toEqual({ timeMin: "2026-10-22T00:00:00+03:00", timeMax: "2026-10-29T00:00:00+02:00" });
    expect(thrownBy(() => windowOf({ from: "2026-10-01", to: "", days: 63 }, TZ, 0, 62)).message).toMatch(/between 1 and 62/);
    expect(thrownBy(() => windowOf({ from: "2026-10-01", to: "2027-01-01", days: 7 }, TZ, 0, 62)).message).toMatch(/longer than 62 days/);
    expect(thrownBy(() => windowOf({ from: "2026-10-02", to: "2026-10-01", days: 7 }, TZ, 0, 62)).message).toMatch(/after/);
  });

  it("reads HH:MM as minutes after midnight, 24:00 included, and nothing else", () => {
    expect(parseClockTime("09:30", "start")).toBe(570);
    expect(parseClockTime("24:00", "end")).toBe(1440);
    for (const bad of ["9:30", "24:01", "12:60", "noon"]) expect(thrownBy(() => parseClockTime(bad, "start")).kind).toBe("input");
  });

  it("turns local minutes into an instant with the offset of that day, 1440 being the next midnight", () => {
    expect(localMinutesToEpoch("2026-03-27", 540, TZ)).toBe(Date.parse("2026-03-27T07:00:00Z"));
    expect(localMinutesToEpoch("2026-03-30", 540, TZ)).toBe(Date.parse("2026-03-30T06:00:00Z"));
    expect(localMinutesToEpoch("2026-10-25", 1440, TZ)).toBe(Date.parse("2026-10-25T22:00:00Z"));
  });

  it("writes an instant in a given offset, and reads the offset a string is written in", () => {
    expect(formatWithOffset(Date.parse("2026-10-01T07:00:00Z"), "+03:00")).toBe("2026-10-01T10:00:00+03:00");
    expect(formatWithOffset(Date.parse("2026-10-01T07:00:00Z"), "-04:30")).toBe("2026-10-01T02:30:00-04:30");
    expect(offsetOfText("2026-10-01T10:00:00+03:00")).toBe("+03:00");
    expect(offsetOfText("2026-10-01T07:00:00Z")).toBe("+00:00");
  });

  it("merges overlapping and touching intervals in order, leaving its argument alone", () => {
    const input = [i(50, 60), i(10, 20), i(20, 30), i(15, 25), i(40, 45)];
    expect(mergeIntervals(input)).toEqual([i(10, 30), i(40, 45), i(50, 60)]);
    expect(input[0]).toEqual(i(50, 60));
    const flagged = mergeIntervals([{ ...i(0, 10), n: 1 }, { ...i(5, 15), n: 2 }], (a, b, span) => ({ ...span, n: a.n + b.n }));
    expect(flagged).toEqual([{ ...i(0, 15), n: 3 }]);
  });

  it("subtracts taken intervals from a stretch", () => {
    expect(subtractIntervals(i(0, 100), [i(-10, 5), i(20, 30), i(30, 40), i(90, 200)])).toEqual([i(5, 20), i(40, 90)]);
    expect(subtractIntervals(i(0, 100), [])).toEqual([i(0, 100)]);
    expect(subtractIntervals(i(0, 100), [i(0, 100)])).toEqual([]);
  });
});

describe("the busy rule", () => {
  const cal: RawCalendar = { id: "me@example.com", primary: true };
  const at = { start: { dateTime: "2026-10-01T10:00:00+03:00" }, end: { dateTime: "2026-10-01T11:00:00+03:00" } };

  it("is the same for the agenda as for free/busy: cancelled and working-location entries block nothing", () => {
    expect(summarise("personal", cal, { id: "a", ...at }).busy).toBe(true);
    expect(summarise("personal", cal, { id: "b", ...at, status: "cancelled" }).busy).toBe(false);
    expect(summarise("personal", cal, { id: "c", ...at, eventType: "workingLocation" }).busy).toBe(false);
    expect(summarise("personal", cal, { id: "d", ...at, transparency: "transparent" }).busy).toBe(false);
  });

  it("reads other people's free/busy only with a scope that opens freebusy.query to them", () => {
    const S = "https://www.googleapis.com/auth/";
    expect(canReadAttendeeFreeBusy([`${S}calendar.events`, `${S}calendar.calendarlist.readonly`])).toBe(false);
    expect(canReadAttendeeFreeBusy([`${S}calendar.freebusy`])).toBe(false);
    expect(canReadAttendeeFreeBusy([`${S}calendar.events.freebusy`])).toBe(true);
    expect(canReadAttendeeFreeBusy([`${S}calendar.readonly`])).toBe(true);
    expect(canReadAttendeeFreeBusy([`${S}calendar`])).toBe(true);
  });
});

describe("mergeAgenda", () => {
  it("interleaves both accounts in time order", () => {
    const merged = mergeAgenda(
      [
        { account: "personal", calendar: primary, events: [ev("dentist", "2026-09-29T11:00:00+03:00", "2026-09-29T12:00:00+03:00")] },
        { account: "work", calendar: work, events: [ev("standup", "2026-09-29T09:30:00+03:00", "2026-09-29T09:45:00+03:00")] },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(merged.map((e) => `${e.account}:${e.title}`)).toEqual(["work:standup", "personal:dentist"]);
  });

  it("lists an invitation both accounts received once, and says where else it was", () => {
    const invite = ev("interview", "2026-09-30T14:00:00+03:00", "2026-09-30T15:00:00+03:00");
    const merged = mergeAgenda(
      [
        { account: "personal", calendar: primary, events: [invite] },
        { account: "work", calendar: work, events: [{ ...invite, id: "other-id" }] },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.alsoOn).toEqual(["work/Work"]);
  });

  // Every instance of a series shares one iCalUID; folding on it alone would keep only the first week.
  it("keeps every instance of a recurring series", () => {
    const series = [
      ev("gym", "2026-09-29T19:00:00+03:00", "2026-09-29T20:00:00+03:00", { iCalUID: "gym@example.com", recurringEventId: "gym" }),
      ev("gym_2", "2026-10-06T19:00:00+03:00", "2026-10-06T20:00:00+03:00", { iCalUID: "gym@example.com", recurringEventId: "gym" }),
    ];
    const merged = mergeAgenda([{ account: "personal", calendar: primary, events: series }], { includeDeclined: false, timeZone: TZ });
    expect(merged).toHaveLength(2);
    expect(merged.every((e) => e.recurring)).toBe(true);
  });

  it("drops declined, cancelled and working-location entries", () => {
    const declined = ev("declined", "2026-09-29T10:00:00+03:00", "2026-09-29T11:00:00+03:00", {
      attendees: [{ email: "me@work.example", self: true, responseStatus: "declined" }],
    });
    const merged = mergeAgenda(
      [
        {
          account: "work",
          calendar: work,
          events: [
            declined,
            ev("cancelled", "2026-09-29T10:00:00+03:00", "2026-09-29T11:00:00+03:00", { status: "cancelled" }),
            ev("office", "2026-09-29", "2026-09-30", { eventType: "workingLocation" }),
          ],
        },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(merged).toEqual([]);
  });
});

describe("findConflicts", () => {
  it("finds a clash between a work meeting and a personal appointment", () => {
    const merged = mergeAgenda(
      [
        { account: "personal", calendar: primary, events: [ev("dentist", "2026-09-29T11:00:00+03:00", "2026-09-29T12:00:00+03:00")] },
        { account: "work", calendar: work, events: [ev("review", "2026-09-29T11:30:00+03:00", "2026-09-29T12:30:00+03:00")] },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    const conflicts = findConflicts(merged, TZ);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ a: { title: "dentist", account: "personal" }, b: { title: "review", account: "work" }, overlapMinutes: 30 });
  });

  // A booking confirmation can land in two calendars, titled with and without the vendor's name.
  it("marks one appointment booked into both accounts as the same event, not a clash", () => {
    const merged = mergeAgenda(
      [
        { account: "personal", calendar: primary, events: [ev("Example Repair: Înlocuire ecran", "2026-06-15T13:00:00+03:00", "2026-06-15T14:00:00+03:00")] },
        { account: "work", calendar: work, events: [ev("Înlocuire ecran", "2026-06-15T13:00:00+03:00", "2026-06-15T14:00:00+03:00")] },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(findConflicts(merged, TZ)).toEqual([expect.objectContaining({ probablySameEvent: true, overlapMinutes: 60 })]);
  });

  it("does not count back-to-back, free, or all-day events", () => {
    const merged = mergeAgenda(
      [
        {
          account: "personal",
          calendar: primary,
          events: [
            ev("a", "2026-09-29T10:00:00+03:00", "2026-09-29T11:00:00+03:00"),
            ev("b", "2026-09-29T11:00:00+03:00", "2026-09-29T12:00:00+03:00"),
            ev("reminder", "2026-09-29T10:30:00+03:00", "2026-09-29T10:45:00+03:00", { transparency: "transparent" }),
            ev("holiday", "2026-09-29", "2026-09-30"),
          ],
        },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(findConflicts(merged, TZ)).toEqual([]);
  });
});

describe("pendingInvites", () => {
  it("is the events still waiting for my answer, not the ones I organise", () => {
    const merged = mergeAgenda(
      [
        {
          account: "work",
          calendar: work,
          events: [
            ev("invite", "2026-09-29T10:00:00+03:00", "2026-09-29T11:00:00+03:00", {
              organizer: { email: "boss@work.example" },
              attendees: [{ email: "me@work.example", self: true, responseStatus: "needsAction" }],
            }),
            ev("mine", "2026-09-29T12:00:00+03:00", "2026-09-29T13:00:00+03:00", {
              organizer: { email: "me@work.example", self: true },
              attendees: [{ email: "me@work.example", self: true, organizer: true, responseStatus: "accepted" }],
            }),
          ],
        },
      ],
      { includeDeclined: false, timeZone: TZ },
    );
    expect(pendingInvites(merged).map((e) => e.title)).toEqual(["invite"]);
  });
});

describe("eventBody", () => {
  it("gives a timed event an hour and the zone, when no end is given", () => {
    expect(eventBody({ title: "Dentist", start: "2026-10-02T09:00" }, TZ)).toEqual({
      summary: "Dentist",
      start: { dateTime: "2026-10-02T09:00:00+03:00", timeZone: TZ },
      end: { dateTime: "2026-10-02T10:00:00+03:00", timeZone: TZ },
    });
  });

  it("makes a whole day end on the next date, which Google reads as exclusive", () => {
    expect(eventBody({ title: "Holiday", start: "2026-10-02" }, TZ)).toMatchObject({ start: { date: "2026-10-02" }, end: { date: "2026-10-03" } });
  });

  it("keeps a meeting's length when only its start moves", () => {
    const existing = ev("sync", "2026-10-02T09:00:00+03:00", "2026-10-02T09:30:00+03:00");
    expect(eventBody({ start: "2026-10-02T11:00" }, TZ, existing)).toEqual({
      start: { dateTime: "2026-10-02T11:00:00+03:00", timeZone: TZ },
      end: { dateTime: "2026-10-02T11:30:00+03:00", timeZone: TZ },
    });
  });

  it("sends only what changed on an update", () => {
    const existing = ev("sync", "2026-10-02T09:00:00+03:00", "2026-10-02T09:30:00+03:00");
    expect(eventBody({ location: "Sala 2" }, TZ, existing)).toEqual({ location: "Sala 2" });
  });

  it("refuses an end before the start, a mixed day and time, and a bad guest", () => {
    expect(thrownBy(() => eventBody({ title: "x", start: "2026-10-02T10:00", end: "2026-10-02T09:00" }, TZ)).kind).toBe("input");
    expect(thrownBy(() => eventBody({ title: "x", start: "2026-10-02", end: "2026-10-02T09:00" }, TZ)).kind).toBe("input");
    expect(thrownBy(() => eventBody({ title: "x", start: "2026-10-02T10:00", attendees: ["not-an-email"] }, TZ)).kind).toBe("input");
    expect(thrownBy(() => eventBody({ start: "2026-10-02T10:00" }, TZ)).kind).toBe("input");
  });

  it("makes a birthday a yearly all-day event, and refuses a rule that is not RFC 5545", () => {
    expect(eventBody({ title: "Birthday", start: "2027-05-20", recurrence: ["RRULE:FREQ=YEARLY"], busy: false }, TZ)).toMatchObject({
      start: { date: "2027-05-20" },
      end: { date: "2027-05-21" },
      recurrence: ["RRULE:FREQ=YEARLY"],
      transparency: "transparent",
    });
    expect(thrownBy(() => eventBody({ title: "x", start: "2027-05-20", recurrence: ["every year"] }, TZ)).kind).toBe("input");
  });

  it("turns reminders and busy into Google's shapes", () => {
    expect(eventBody({ title: "Gym", start: "2026-10-02T19:00", remindersMinutes: [30], busy: false }, TZ)).toMatchObject({
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
      transparency: "transparent",
    });
  });
});

describe("withMyResponse", () => {
  const invite = ev("invite", "2026-09-29T10:00:00+03:00", "2026-09-29T11:00:00+03:00", {
    organizer: { email: "boss@work.example" },
    attendees: [
      { email: "boss@work.example", organizer: true, responseStatus: "accepted" },
      { email: "me@work.example", self: true, responseStatus: "needsAction" },
    ],
  });

  it("changes my answer and nobody else's", () => {
    expect(withMyResponse(invite, "accepted")).toEqual([
      { email: "boss@work.example", organizer: true, responseStatus: "accepted" },
      { email: "me@work.example", self: true, responseStatus: "accepted" },
    ]);
  });

  it("refuses when there is no invitation to answer", () => {
    expect(thrownBy(() => withMyResponse({ ...invite, organizer: { email: "me@work.example", self: true } }, "declined")).kind).toBe("input");
    expect(thrownBy(() => withMyResponse({ ...invite, attendees: [] }, "declined")).kind).toBe("input");
  });
});

describe("missingScopes", () => {
  it("names what a grant lacks, and accepts the full scope as covering both", () => {
    expect(missingScopes(["https://www.googleapis.com/auth/calendar.events"])).toEqual(["https://www.googleapis.com/auth/calendar.calendarlist.readonly"]);
    expect(missingScopes(["https://www.googleapis.com/auth/calendar"])).toEqual([]);
  });
});
