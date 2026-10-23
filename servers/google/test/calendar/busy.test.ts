import { describe, expect, it } from "vitest";

import { busyFromEvents, busyOf, mergeBusy, readAttendees } from "../../src/calendar/domain/busy.js";
import type { RawEvent, RawFreeBusyResponse } from "../../src/calendar/domain/schema.js";
import { clip } from "../../src/calendar/domain/time.js";

const TZ = "Europe/Bucharest";
const at = (iso: string): number => Date.parse(iso);

const timed = (start: string, end: string, extra: Partial<RawEvent> = {}): RawEvent => ({
  id: `${start}`,
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

const me = (responseStatus: string) => ({ attendees: [{ email: "boss@example.com", organizer: true }, { email: "me@example.com", self: true, responseStatus }] });

describe("busyOf: what counts as busy on the user's own calendars", () => {
  const hour = ["2026-10-01T10:00:00+03:00", "2026-10-01T11:00:00+03:00"] as const;

  it("counts a plain event as firm busy time", () => {
    expect(busyOf(timed(...hour), TZ)).toEqual({
      kind: "busy",
      block: { startMs: at("2026-10-01T07:00:00Z"), endMs: at("2026-10-01T08:00:00Z"), tentative: false, allDay: false },
    });
  });

  it("frees what does not block time: cancelled, show-as-available, declined, working location", () => {
    expect(busyOf(timed(...hour, { status: "cancelled" }), TZ)).toEqual({ kind: "free", why: "cancelled" });
    expect(busyOf(timed(...hour, { transparency: "transparent" }), TZ)).toEqual({ kind: "free", why: "transparent" });
    expect(busyOf(timed(...hour, me("declined")), TZ)).toEqual({ kind: "free", why: "declined" });
    expect(busyOf(timed(...hour, { eventType: "workingLocation" }), TZ)).toEqual({ kind: "free", why: "not_an_appointment" });
  });

  it("keeps tentative time busy but flags it: a tentative event, or a maybe answer", () => {
    expect(busyOf(timed(...hour, { status: "tentative" }), TZ)).toMatchObject({ kind: "busy", block: { tentative: true } });
    expect(busyOf(timed(...hour, me("tentative")), TZ)).toMatchObject({ kind: "busy", block: { tentative: true } });
  });

  it("counts an unanswered invitation and an accepted one as firm, as Google's own free/busy does", () => {
    expect(busyOf(timed(...hour, me("needsAction")), TZ)).toMatchObject({ kind: "busy", block: { tentative: false } });
    expect(busyOf(timed(...hour, me("accepted")), TZ)).toMatchObject({ kind: "busy", block: { tentative: false } });
  });

  it("places an all-day busy event on its calendar's local days", () => {
    const allDay: RawEvent = { id: "offsite", start: { date: "2026-10-01" }, end: { date: "2026-10-03" } };
    expect(busyOf(allDay, TZ)).toEqual({
      kind: "busy",
      block: { startMs: at("2026-09-30T21:00:00Z"), endMs: at("2026-10-02T21:00:00Z"), tentative: false, allDay: true },
    });
    // The same day in a calendar kept in London starts two hours later.
    expect(busyOf(allDay, "Europe/London")).toMatchObject({ block: { startMs: at("2026-09-30T23:00:00Z") } });
  });

  it("says when a busy event cannot be placed, and frees a zero-length one", () => {
    expect(busyOf({ id: "x", start: { dateTime: "2026-10-01T10:00:00+03:00" } }, TZ)).toEqual({ kind: "unplaceable" });
    expect(busyOf(timed("not a time", "2026-10-01T11:00:00+03:00"), TZ)).toEqual({ kind: "unplaceable" });
    expect(busyOf(timed(hour[0], hour[0]), TZ)).toEqual({ kind: "free", why: "zero_length" });
  });

  it("counts the unplaceable ones instead of dropping them", () => {
    const { blocks, unplaceable } = busyFromEvents([timed(...hour), { id: "broken" }, timed(...hour, { transparency: "transparent" })], TZ);
    expect(blocks).toHaveLength(1);
    expect(unplaceable).toBe(1);
  });
});

describe("mergeBusy", () => {
  const b = (start: string, end: string, tentative = false) => ({ startMs: at(start), endMs: at(end), tentative });

  it("joins overlapping and touching blocks, and counts the same meeting on both accounts once", () => {
    const merged = mergeBusy([
      b("2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z"),
      b("2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z"),
      b("2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z"),
      b("2026-10-01T07:30:00Z", "2026-10-01T09:00:00Z"),
      b("2026-10-01T09:00:00Z", "2026-10-01T09:30:00Z"),
    ]);
    expect(merged).toEqual([b("2026-10-01T07:00:00Z", "2026-10-01T09:30:00Z"), b("2026-10-01T12:00:00Z", "2026-10-01T13:00:00Z")]);
  });

  it("keeps a merged block tentative only when every part of it was", () => {
    expect(mergeBusy([b("2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z", true), b("2026-10-01T07:30:00Z", "2026-10-01T08:30:00Z", true)])).toEqual([
      b("2026-10-01T07:00:00Z", "2026-10-01T08:30:00Z", true),
    ]);
    expect(mergeBusy([b("2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z", true), b("2026-10-01T07:30:00Z", "2026-10-01T08:30:00Z")])[0]?.tentative).toBe(false);
  });

  it("is empty for nothing, and does not touch its argument", () => {
    const input = [b("2026-10-01T09:00:00Z", "2026-10-01T10:00:00Z"), b("2026-10-01T07:00:00Z", "2026-10-01T08:00:00Z")];
    const copy = JSON.stringify(input);
    mergeBusy(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(mergeBusy([])).toEqual([]);
  });
});

describe("clip", () => {
  it("keeps the part inside the window and drops the rest", () => {
    const window = { startMs: at("2026-10-01T06:00:00Z"), endMs: at("2026-10-01T15:00:00Z") };
    expect(
      clip(
        [
          { startMs: at("2026-09-30T21:00:00Z"), endMs: at("2026-10-01T21:00:00Z") },
          { startMs: at("2026-10-02T06:00:00Z"), endMs: at("2026-10-02T07:00:00Z") },
        ],
        window,
      ),
    ).toEqual([window]);
  });
});

describe("readAttendees: other people through freebusy.query", () => {
  const period = { start: "2026-10-01T07:00:00Z", end: "2026-10-01T08:00:00Z" };
  const block = { startMs: at(period.start), endMs: at(period.end), tentative: false };

  it("reads busy periods, and a calendar with no busy list as free", () => {
    const response: RawFreeBusyResponse = { calendars: { "ana@example.com": { busy: [period] }, "bob@example.com": {} } };
    expect(readAttendees(response, ["ana@example.com", "bob@example.com"])).toEqual([
      { kind: "known", email: "ana@example.com", blocks: [block] },
      { kind: "known", email: "bob@example.com", blocks: [] },
    ]);
  });

  it("never reads an error or a missing answer as free time", () => {
    const response: RawFreeBusyResponse = { calendars: { "ext@example.org": { busy: [], errors: [{ domain: "global", reason: "notFound" }] } } };
    const [refused, missing] = readAttendees(response, ["ext@example.org", "nobody@example.org"]);
    expect(refused).toMatchObject({ kind: "unknown", reasons: [expect.stringContaining("notFound")] });
    expect(missing).toMatchObject({ kind: "unknown", reasons: ["Google returned no free/busy for this address"] });
    expect(readAttendees({}, ["ana@example.com"])[0]?.kind).toBe("unknown");
  });

  it("passes an unfamiliar reason through, and names an error without one", () => {
    const response: RawFreeBusyResponse = { calendars: { "a@x.example": { errors: [{ reason: "somethingNew" }, { domain: "global" }] } } };
    expect(readAttendees(response, ["a@x.example"])[0]).toMatchObject({ reasons: ["somethingNew", "unspecified error (global)"] });
  });

  it("refuses a whole answer holding a busy period without an end", () => {
    const response: RawFreeBusyResponse = { calendars: { "ana@example.com": { busy: [period, { start: period.start }] } } };
    expect(readAttendees(response, ["ana@example.com"])[0]).toMatchObject({ kind: "unknown" });
  });

  it("finds an answer echoed with different case", () => {
    const response: RawFreeBusyResponse = { calendars: { "ana@example.com": { busy: [period] } } };
    expect(readAttendees(response, ["Ana@Example.com"])[0]).toMatchObject({ kind: "known", email: "Ana@Example.com" });
  });

  it("reads a group as busy whenever a member is, and unknown if any member is", () => {
    const later = { start: "2026-10-01T07:30:00Z", end: "2026-10-01T09:00:00Z" };
    const ok: RawFreeBusyResponse = {
      groups: { "team@example.com": { calendars: ["ana@example.com", "bob@example.com"] } },
      calendars: { "ana@example.com": { busy: [period] }, "bob@example.com": { busy: [later] } },
    };
    expect(readAttendees(ok, ["team@example.com"])[0]).toEqual({
      kind: "known",
      email: "team@example.com",
      blocks: [{ startMs: at(period.start), endMs: at(later.end), tentative: false }],
    });
    const partial: RawFreeBusyResponse = { ...ok, calendars: { "ana@example.com": { busy: [period] } } };
    expect(readAttendees(partial, ["team@example.com"])[0]).toMatchObject({ kind: "unknown", reasons: [expect.stringContaining("bob@example.com")] });
    const tooBig: RawFreeBusyResponse = { groups: { "all@example.com": { errors: [{ reason: "groupTooBig" }] } } };
    expect(readAttendees(tooBig, ["all@example.com"])[0]).toMatchObject({ kind: "unknown", reasons: [expect.stringContaining("groupTooBig")] });
  });
});
