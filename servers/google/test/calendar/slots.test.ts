import { describe, expect, it } from "vitest";

import { busyOf } from "../../src/calendar/domain/busy.js";
import { asAppError, type AppError } from "../../src/calendar/domain/errors.js";
import { findSlots, type SlotRequest, workingStretches } from "../../src/calendar/domain/slots.js";
import { instantIn, type Interval } from "../../src/calendar/domain/time.js";

const TZ = "Europe/Bucharest";
const at = (iso: string): number => Date.parse(iso);
const span = (start: string, end: string): Interval => ({ startMs: at(start), endMs: at(end) });
const WEEK = ["mon", "tue", "wed", "thu", "fri"] as const;

/** Thursday 2026-10-01, a plain working day in Bucharest summer time (+03:00). */
const THURSDAY = span("2026-10-01T00:00:00+03:00", "2026-10-02T00:00:00+03:00");

const request = (over: Partial<SlotRequest> = {}): SlotRequest => ({
  window: THURSDAY,
  // Before every window here, so only the tests about notice are shaped by it.
  nowMs: at("2026-01-01T00:00:00Z"),
  durationMinutes: 60,
  stepMinutes: 30,
  minNoticeMinutes: 0,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  hours: { days: WEEK, start: "09:00", end: "18:00", timeZone: TZ },
  prefer: "earliest",
  limit: 100,
  ...over,
});

/** Slot starts as the user reads them. */
const starts = (busy: readonly Interval[], over: Partial<SlotRequest> = {}, zone = TZ): readonly string[] =>
  findSlots(busy, request(over)).slots.map((s) => instantIn(s.startMs, zone));

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

describe("findSlots: the basics", () => {
  it("offers every grid start that fits in working hours on a free day", () => {
    const result = findSlots([], request());
    expect(result.slots).toHaveLength(17); // 09:00 ... 17:00 for an hour, every 30 minutes
    expect(instantIn(result.slots[0]?.startMs ?? 0, TZ)).toBe("2026-10-01T09:00:00+03:00");
    expect(instantIn(result.slots[16]?.endMs ?? 0, TZ)).toBe("2026-10-01T18:00:00+03:00");
    expect(result.ranges).toEqual([span("2026-10-01T09:00:00+03:00", "2026-10-01T18:00:00+03:00")]);
    expect(result.more).toBe(0);
  });

  it("works around overlapping and duplicated busy blocks", () => {
    const busy = [
      span("2026-10-01T10:00:00+03:00", "2026-10-01T11:00:00+03:00"),
      span("2026-10-01T10:30:00+03:00", "2026-10-01T11:30:00+03:00"),
      span("2026-10-01T14:00:00+03:00", "2026-10-01T15:00:00+03:00"),
      span("2026-10-01T14:00:00+03:00", "2026-10-01T15:00:00+03:00"),
    ];
    expect(starts(busy)).toEqual([
      "2026-10-01T09:00:00+03:00",
      "2026-10-01T11:30:00+03:00",
      "2026-10-01T12:00:00+03:00",
      "2026-10-01T12:30:00+03:00",
      "2026-10-01T13:00:00+03:00",
      "2026-10-01T15:00:00+03:00",
      "2026-10-01T15:30:00+03:00",
      "2026-10-01T16:00:00+03:00",
      "2026-10-01T16:30:00+03:00",
      "2026-10-01T17:00:00+03:00",
    ]);
    expect(findSlots(busy, request()).ranges).toHaveLength(3);
  });

  it("does not care what order the busy blocks come in", () => {
    const a = span("2026-10-01T10:00:00+03:00", "2026-10-01T11:00:00+03:00");
    const b = span("2026-10-01T15:00:00+03:00", "2026-10-01T16:00:00+03:00");
    expect(starts([b, a])).toEqual(starts([a, b]));
  });

  it("loses the whole day to an all-day busy event and resumes the next working day", () => {
    const offsite = busyOf({ id: "offsite", start: { date: "2026-10-01" }, end: { date: "2026-10-02" } }, TZ);
    if (offsite.kind !== "busy") throw new Error("expected busy");
    const window = span("2026-10-01T00:00:00+03:00", "2026-10-03T00:00:00+03:00");
    expect(starts([offsite.block], { window })[0]).toBe("2026-10-02T09:00:00+03:00");
  });

  it("keeps the grid when the window starts mid-slot: 10:07 offers 10:30, not 10:07", () => {
    expect(starts([], { window: span("2026-10-01T10:07:00+03:00", "2026-10-02T00:00:00+03:00") })[0]).toBe("2026-10-01T10:30:00+03:00");
  });

  it("counts the grid from the start of working hours", () => {
    expect(starts([], { hours: { days: WEEK, start: "09:15", end: "11:00", timeZone: TZ }, durationMinutes: 30 })).toEqual([
      "2026-10-01T09:15:00+03:00",
      "2026-10-01T09:45:00+03:00",
      "2026-10-01T10:15:00+03:00",
    ]);
  });

  it("ends a slot inside the window, not just inside working hours", () => {
    expect(starts([], { window: span("2026-10-01T00:00:00+03:00", "2026-10-01T11:00:00+03:00") })).toEqual([
      "2026-10-01T09:00:00+03:00",
      "2026-10-01T09:30:00+03:00",
      "2026-10-01T10:00:00+03:00",
    ]);
  });

  it("reads 24:00 as the end of the day", () => {
    expect(starts([], { hours: { days: WEEK, start: "20:00", end: "24:00", timeZone: TZ }, stepMinutes: 60 })).toEqual([
      "2026-10-01T20:00:00+03:00",
      "2026-10-01T21:00:00+03:00",
      "2026-10-01T22:00:00+03:00",
      "2026-10-01T23:00:00+03:00",
    ]);
  });

  it("uses the working-hours zone, not Bucharest, when told another", () => {
    expect(starts([], { hours: { days: WEEK, start: "09:00", end: "10:00", timeZone: "Europe/London" } }, "UTC")).toEqual([
      "2026-10-01T08:00:00+00:00",
    ]);
  });
});

describe("findSlots: notice and buffers", () => {
  it("starts no sooner than the notice allows, back on the grid", () => {
    expect(starts([], { nowMs: at("2026-10-01T10:10:00+03:00"), minNoticeMinutes: 60 })[0]).toBe("2026-10-01T11:30:00+03:00");
  });

  it("offers nothing in the past even with no notice", () => {
    expect(starts([], { nowMs: at("2026-10-01T16:45:00+03:00") })).toEqual(["2026-10-01T17:00:00+03:00"]);
  });

  it("keeps the buffers clear before and after an existing event", () => {
    const busy = [span("2026-10-01T11:00:00+03:00", "2026-10-01T12:00:00+03:00")];
    const got = starts(busy, { durationMinutes: 30, stepMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
    expect(got).toContain("2026-10-01T10:15:00+03:00"); // ends 10:45, a clear 15 before 11:00
    expect(got).not.toContain("2026-10-01T10:30:00+03:00"); // would end at 11:00 with no buffer
    expect(got).not.toContain("2026-10-01T12:00:00+03:00"); // would start with no buffer
    expect(got).toContain("2026-10-01T12:15:00+03:00");
  });

  it("closes a gap between two meetings that the buffers swallow", () => {
    const busy = [span("2026-10-01T10:00:00+03:00", "2026-10-01T10:30:00+03:00"), span("2026-10-01T11:30:00+03:00", "2026-10-01T12:00:00+03:00")];
    const got = starts(busy, { durationMinutes: 45, stepMinutes: 15, bufferBeforeMinutes: 10, bufferAfterMinutes: 10 });
    expect(got.filter((s) => s > "2026-10-01T10:00" && s < "2026-10-01T12:00")).toEqual([]);
  });

  it("lets a buffer from a meeting before the window reach into it", () => {
    const early = [span("2026-10-01T08:30:00+03:00", "2026-10-01T09:00:00+03:00")];
    expect(starts(early, { bufferAfterMinutes: 30 })[0]).toBe("2026-10-01T09:30:00+03:00");
  });
});

describe("findSlots: DST in Europe/Bucharest (last Sunday of March and of October)", () => {
  it("keeps 09:00 local across the March change: +02:00 on Friday, +03:00 on Monday", () => {
    const result = findSlots([], request({ window: span("2026-03-27T00:00:00+02:00", "2026-03-31T00:00:00+03:00") }));
    expect(result.ranges).toEqual([span("2026-03-27T07:00:00Z", "2026-03-27T16:00:00Z"), span("2026-03-30T06:00:00Z", "2026-03-30T15:00:00Z")]);
    expect(instantIn(result.slots[0]?.startMs ?? 0, TZ)).toBe("2026-03-27T09:00:00+02:00");
    expect(result.slots.map((s) => instantIn(s.startMs, TZ))).toContain("2026-03-30T09:00:00+03:00");
  });

  it("keeps 09:00 local across the October change: +03:00 on Friday, +02:00 on Monday", () => {
    const result = findSlots([], request({ window: span("2026-10-23T00:00:00+03:00", "2026-10-27T00:00:00+02:00") }));
    expect(result.ranges).toEqual([span("2026-10-23T06:00:00Z", "2026-10-23T15:00:00Z"), span("2026-10-26T07:00:00Z", "2026-10-26T16:00:00Z")]);
  });

  it("gives the March Sunday's 00:00-06:00 five real hours: 03:00 does not exist", () => {
    const got = starts([], {
      window: span("2026-03-29T00:00:00+02:00", "2026-03-30T00:00:00+03:00"),
      hours: { days: ["sun"], start: "00:00", end: "06:00", timeZone: TZ },
      stepMinutes: 60,
    });
    expect(got).toEqual([
      "2026-03-29T00:00:00+02:00",
      "2026-03-29T01:00:00+02:00",
      "2026-03-29T02:00:00+02:00",
      "2026-03-29T04:00:00+03:00",
      "2026-03-29T05:00:00+03:00",
    ]);
  });

  it("gives the October Sunday's 00:00-06:00 seven real hours: 03:00 happens twice", () => {
    const got = starts([], {
      window: span("2026-10-25T00:00:00+03:00", "2026-10-26T00:00:00+02:00"),
      hours: { days: ["sun"], start: "00:00", end: "06:00", timeZone: TZ },
      stepMinutes: 60,
    });
    expect(got).toEqual([
      "2026-10-25T00:00:00+03:00",
      "2026-10-25T01:00:00+03:00",
      "2026-10-25T02:00:00+03:00",
      "2026-10-25T03:00:00+03:00",
      "2026-10-25T03:00:00+02:00",
      "2026-10-25T04:00:00+02:00",
      "2026-10-25T05:00:00+02:00",
    ]);
  });

  it("builds one stretch per working day, none on the weekend of the change", () => {
    const stretches = workingStretches(span("2026-10-24T00:00:00+03:00", "2026-10-26T00:00:00+02:00"), { days: WEEK, start: "09:00", end: "18:00", timeZone: TZ });
    expect(stretches).toEqual([]);
  });
});

describe("findSlots: ranking, the limit, and nothing at all", () => {
  const twoDays = span("2026-10-01T00:00:00+03:00", "2026-10-03T00:00:00+03:00");

  it("ranks earliest first and says how many more there were", () => {
    const result = findSlots([], request({ limit: 5 }));
    expect(result.slots.map((s) => instantIn(s.startMs, TZ))).toEqual([
      "2026-10-01T09:00:00+03:00",
      "2026-10-01T09:30:00+03:00",
      "2026-10-01T10:00:00+03:00",
      "2026-10-01T10:30:00+03:00",
      "2026-10-01T11:00:00+03:00",
    ]);
    expect(result.more).toBe(12);
  });

  it("puts every morning first when mornings are preferred, each group in time order", () => {
    const got = starts([], { window: twoDays, prefer: "morning", limit: 13 });
    expect(got.slice(0, 6)).toEqual([
      "2026-10-01T09:00:00+03:00",
      "2026-10-01T09:30:00+03:00",
      "2026-10-01T10:00:00+03:00",
      "2026-10-01T10:30:00+03:00",
      "2026-10-01T11:00:00+03:00",
      "2026-10-01T11:30:00+03:00",
    ]);
    expect(got[11]).toBe("2026-10-02T11:30:00+03:00");
    expect(got[12]).toBe("2026-10-01T12:00:00+03:00");
  });

  it("puts afternoons first when they are preferred", () => {
    expect(starts([], { window: twoDays, prefer: "afternoon", limit: 2 })).toEqual(["2026-10-01T12:00:00+03:00", "2026-10-01T12:30:00+03:00"]);
  });

  it("returns nothing, cleanly, for a fully booked day", () => {
    const result = findSlots([span("2026-10-01T08:00:00+03:00", "2026-10-01T19:00:00+03:00")], request());
    expect(result).toEqual({ slots: [], more: 0, ranges: [] });
  });

  it("returns nothing for a meeting longer than the working day, and nothing on a weekend", () => {
    expect(starts([], { durationMinutes: 600 })).toEqual([]);
    expect(starts([], { window: span("2026-10-03T00:00:00+03:00", "2026-10-05T00:00:00+03:00") })).toEqual([]);
  });

  it("lists only the free ranges that hold a slot", () => {
    const busy = [span("2026-10-01T09:00:00+03:00", "2026-10-01T09:10:00+03:00"), span("2026-10-01T09:35:00+03:00", "2026-10-01T18:00:00+03:00")];
    // 09:10-09:35 holds 20 minutes, but on a 30-minute grid no start fits it.
    expect(findSlots(busy, request({ durationMinutes: 20 })).ranges).toEqual([]);
    expect(findSlots(busy, request({ durationMinutes: 20, stepMinutes: 5 })).ranges).toEqual([span("2026-10-01T09:10:00+03:00", "2026-10-01T09:35:00+03:00")]);
  });
});

describe("findSlots: refuses what cannot be answered", () => {
  it("names the bad argument", () => {
    const bad = (over: Partial<SlotRequest>) => thrownBy(() => findSlots([], request(over)));
    expect(bad({ hours: { days: WEEK, start: "18:00", end: "09:00", timeZone: TZ } }).message).toMatch(/overnight/);
    expect(bad({ hours: { days: WEEK, start: "9am", end: "18:00", timeZone: TZ } }).message).toMatch(/HH:MM/);
    expect(bad({ hours: { days: WEEK, start: "09:00", end: "24:30", timeZone: TZ } }).message).toMatch(/HH:MM/);
    expect(bad({ hours: { days: [], start: "09:00", end: "18:00", timeZone: TZ } }).message).toMatch(/empty/);
    expect(bad({ hours: { days: WEEK, start: "09:00", end: "18:00", timeZone: "Mars/Olympus" } }).message).toMatch(/IANA/);
    expect(bad({ window: span("2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z") }).kind).toBe("input");
    expect(bad({ durationMinutes: 0 }).kind).toBe("input");
    expect(bad({ bufferAfterMinutes: -5 }).kind).toBe("input");
  });
});
