import { describe, expect, it } from "vitest";

import type { CalendarPort, Deps } from "../../src/calendar/app/ports.js";
import { agenda } from "../../src/calendar/app/usecases/agenda.js";
import { createEvent, deleteEvent, respondToInvite, updateEvent } from "../../src/calendar/app/usecases/events.js";
import { checkHealth } from "../../src/calendar/app/usecases/health.js";
import { asAppError, authError, type AppError, fail } from "../../src/calendar/domain/errors.js";
import type { RawCalendar, RawEvent } from "../../src/calendar/domain/events.js";
import { CALENDAR_EVENTS, CALENDAR_LIST_READONLY } from "../../src/calendar/domain/grants.js";
import { resolveAccounts } from "../../src/calendar/infra/accounts.js";
import { makeCalendarApi } from "../../src/calendar/infra/calendarApi.js";

/**
 * A calendar made of plain objects. Everything here exercises the layer that
 * decides, not the layer that talks, which is why the port names operations.
 */
const makeFake = (account: string, calendars: RawCalendar[], events: Record<string, RawEvent[]>, scopes = [CALENDAR_EVENTS, CALENDAR_LIST_READONLY]) => {
  const writes: { op: string; calendarId: string; body?: unknown; sendUpdates?: string }[] = [];
  const port: CalendarPort = {
    calendars: async () => calendars,
    primary: async () => calendars.find((c) => c.primary) as RawCalendar,
    events: async (calendarId) => {
      const found = events[calendarId];
      if (!found) throw { failed: calendarId };
      return found;
    },
    get: async (calendarId, eventId) => {
      const found = (events[calendarId] ?? []).find((e) => e.id === eventId);
      if (!found) throw new Error(`no event ${eventId}`);
      return found;
    },
    freeBusy: async () => ({}),
    insert: async (calendarId, body, sendUpdates) => {
      writes.push({ op: "insert", calendarId, body, sendUpdates });
      return { id: "new", ...(body as object) } as RawEvent;
    },
    patch: async (calendarId, eventId, body, sendUpdates) => {
      writes.push({ op: "patch", calendarId, body, sendUpdates });
      return { ...(events[calendarId] ?? []).find((e) => e.id === eventId), ...(body as object) } as RawEvent;
    },
    remove: async (calendarId) => {
      writes.push({ op: "remove", calendarId });
    },
    respond: async (calendarId, eventId, attendees, sendUpdates) => {
      writes.push({ op: "respond", calendarId, body: attendees, sendUpdates });
      return { ...(events[calendarId] ?? []).find((e) => e.id === eventId), attendees } as RawEvent;
    },
  };
  const deps: Deps = {
    account,
    address: calendars.find((c) => c.primary)?.id ?? "",
    timeZone: "Europe/Bucharest",
    calendar: port,
    grant: { credentials: `/creds/${account}.json`, scopes: async () => scopes },
    now: () => Date.parse("2026-09-28T06:00:00Z"),
    newId: () => "req-1",
  };
  return { deps, writes };
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

const me: RawCalendar = { id: "me@example.com", summary: "Me", primary: true };
const gym: RawCalendar = { id: "gym-calendar", summary: "Gym", selected: true };
const hidden: RawCalendar = { id: "holidays", summary: "Holidays", selected: false };

describe("agenda", () => {
  it("reads today's week by default, from the selected calendars only", async () => {
    const seen: string[] = [];
    const { deps } = makeFake("personal", [me, gym, hidden], { "me@example.com": [], "gym-calendar": [], holidays: [] });
    const spy: Deps = { ...deps, calendar: { ...deps.calendar, events: async (id, w) => (seen.push(`${id} ${w.timeMin} ${w.timeMax}`), []) } };
    await agenda([spy], { from: "", to: "", days: 7, calendars: "selected", includeDeclined: false, limit: 250 });
    expect(seen.sort()).toEqual([
      "gym-calendar 2026-09-28T00:00:00+03:00 2026-10-05T00:00:00+03:00",
      "me@example.com 2026-09-28T00:00:00+03:00 2026-10-05T00:00:00+03:00",
    ]);
  });

  it("reports one dead calendar beside the events that did arrive", async () => {
    const personal = makeFake("personal", [me], {
      "me@example.com": [{ id: "dentist", summary: "Dentist", start: { dateTime: "2026-09-29T11:00:00+03:00" }, end: { dateTime: "2026-09-29T12:00:00+03:00" } }],
    });
    const work = makeFake("work", [{ id: "me@work.example", primary: true }], {});
    const result = await agenda([personal.deps, work.deps], { from: "2026-09-28", to: "", days: 7, calendars: "selected", includeDeclined: false, limit: 250 });
    expect(result.events.map((e) => e.title)).toEqual(["Dentist"]);
    expect(result.failures).toEqual([{ account: "work", calendar: "me@work.example", error: expect.any(String) }]);
  });
});

describe("agenda and the shared listing", () => {
  it("names a calendar id no account lists, instead of reading it as empty", async () => {
    const { deps } = makeFake("personal", [me, gym], { "me@example.com": [], "gym-calendar": [] });
    const result = await agenda([deps], { from: "2026-09-28", to: "", days: 7, calendars: ["gym-calendar", "gmy-calendar"], includeDeclined: false, limit: 250 });
    expect(result.failures).toEqual([{ calendar: "gmy-calendar", error: expect.stringContaining("list_calendars") }]);
  });
});

describe("a Meet link, focus time and out of office", () => {
  const gym: RawCalendar = { id: "gym-calendar", summary: "Gym" };

  it("asks Google for a new Meet call, tied to one request id", async () => {
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [] });
    await createEvent(deps, "primary", { title: "Weekly sync", start: "2026-10-06T10:00", meet: true }, "none");
    expect(writes[0]?.body).toMatchObject({ conferenceData: { createRequest: { requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } } } });
  });

  it("says when the link is still being made, rather than leaving it out silently", async () => {
    const { deps } = makeFake("work", [me], { "me@example.com": [] });
    const pending: Deps = {
      ...deps,
      calendar: { ...deps.calendar, insert: async () => ({ id: "new", summary: "Call", conferenceData: { createRequest: { status: { statusCode: "pending" } } } }) },
    };
    const result = await createEvent(pending, "primary", { title: "Call", start: "2026-10-02T09:00", meet: true }, "none");
    expect(result).toHaveProperty("meetPending");
  });

  it("says when Google saved the event but could not make its Meet link", async () => {
    const { deps } = makeFake("work", [me], { "me@example.com": [] });
    const failed: Deps = {
      ...deps,
      calendar: { ...deps.calendar, insert: async () => ({ id: "new", summary: "Call", conferenceData: { createRequest: { status: { statusCode: "failure" } } } }) },
    };
    expect(await createEvent(failed, "primary", { title: "Call", start: "2026-10-02T09:00", meet: true }, "none")).toHaveProperty("meetFailed");
  });

  it("names a status event given an empty title as Google's own apps do", async () => {
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [] });
    await createEvent(deps, "primary", { kind: "focusTime", title: " ", start: "2026-10-02T09:00", end: "2026-10-02T10:00" }, "none");
    expect(writes[0]?.body).toMatchObject({ summary: "Focus time" });
  });

  it("adds a Meet link to an event without one, and refuses one that has a link", async () => {
    const bare: RawEvent = { id: "bare", summary: "Sync", start: { dateTime: "2026-10-02T09:00:00+03:00" }, end: { dateTime: "2026-10-02T09:30:00+03:00" } };
    const linked: RawEvent = { ...bare, id: "linked", hangoutLink: "https://meet.google.com/abc-defg-hij" };
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [bare, linked] });
    const result = await updateEvent(deps, "me@example.com", "bare", { meet: true }, "none");
    expect(result).toMatchObject({ changed: ["conferenceData"] });
    expect(await failure(updateEvent(deps, "me@example.com", "linked", { meet: true }, "none"))).toMatchObject({ kind: "input" });
    expect(writes).toHaveLength(1);
  });

  it("makes focus time as Google requires it: its type, busy, its properties, a title of its own", async () => {
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [] });
    await createEvent(deps, "primary", { kind: "focusTime", start: "2026-10-02T09:00", end: "2026-10-02T11:00", chatStatus: "doNotDisturb" }, "none");
    expect(writes[0]?.body).toMatchObject({
      summary: "Focus time",
      eventType: "focusTime",
      transparency: "opaque",
      focusTimeProperties: { autoDeclineMode: "declineNone", chatStatus: "doNotDisturb" },
    });
  });

  it("declines invitations during an out of office only when asked, with the note given", async () => {
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [] });
    await createEvent(deps, "primary", { kind: "outOfOffice", start: "2026-10-05T00:00", end: "2026-10-09T00:00", autoDecline: "new", declineMessage: "Back on the 9th" }, "none");
    expect(writes[0]?.body).toMatchObject({
      summary: "Out of office",
      eventType: "outOfOffice",
      outOfOfficeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations", declineMessage: "Back on the 9th" },
    });
  });

  it("refuses, before anything is sent, what Google refuses for status events", async () => {
    const { deps, writes } = makeFake("work", [me, gym], { "me@example.com": [] });
    const away = { kind: "outOfOffice" as const, start: "2026-10-05T09:00", end: "2026-10-05T17:00" };
    expect(await failure(createEvent(deps, "primary", { ...away, start: "2026-10-05", end: "2026-10-06" }, "none"))).toMatchObject({ kind: "input" });
    expect(await failure(createEvent(deps, "gym-calendar", away, "none"))).toMatchObject({ kind: "input", message: expect.stringContaining("primary") });
    expect(await failure(createEvent(deps, "primary", { ...away, attendees: ["ana@example.com"] }, "none"))).toMatchObject({ kind: "input" });
    expect(await failure(createEvent(deps, "primary", { ...away, meet: true }, "none"))).toMatchObject({ kind: "input" });
    expect(await failure(createEvent(deps, "primary", { ...away, chatStatus: "available" }, "none"))).toMatchObject({ kind: "input" });
    expect(await failure(createEvent(deps, "primary", { title: "Lunch", start: "2026-10-05T12:00", autoDecline: "all" }, "none"))).toMatchObject({ kind: "input" });
    expect(writes).toEqual([]);
  });

  it("changes a status event's settings but never its type", async () => {
    const focus: RawEvent = {
      id: "focus",
      summary: "Focus time",
      eventType: "focusTime",
      start: { dateTime: "2026-10-02T09:00:00+03:00" },
      end: { dateTime: "2026-10-02T11:00:00+03:00" },
      focusTimeProperties: { autoDeclineMode: "declineNone", chatStatus: "doNotDisturb" },
    };
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [focus] });
    await updateEvent(deps, "me@example.com", "focus", { autoDecline: "all" }, "none");
    expect(writes[0]?.body).toEqual({ focusTimeProperties: { autoDeclineMode: "declineAllConflictingInvitations", chatStatus: "doNotDisturb" } });
    expect(await failure(updateEvent(deps, "me@example.com", "focus", { kind: "default" }, "none"))).toMatchObject({ kind: "input" });
  });
});

describe("the Calendar adapter", () => {
  it("asks for conference data version 1 only on a write that carries a Meet request", async () => {
    const sent: { url: string; query: unknown }[] = [];
    const api = makeCalendarApi((async (url: string, options: { query?: unknown }) => (sent.push({ url, query: options.query }), { id: "e" })) as never);
    await api.insert("primary", { summary: "a" }, "none");
    await api.insert("primary", { summary: "b", conferenceData: { createRequest: {} } }, "none");
    expect(sent.map((s) => s.query)).toEqual([{ sendUpdates: "none" }, { sendUpdates: "none", conferenceDataVersion: 1 }]);
  });
});

describe("writes", () => {
  it("emails nobody unless asked", async () => {
    const { deps, writes } = makeFake("personal", [me], { "me@example.com": [] });
    await createEvent(deps, "primary", { title: "Dentist", start: "2026-10-02T09:00" }, "none");
    expect(writes[0]).toMatchObject({ op: "insert", calendarId: "primary", sendUpdates: "none" });
  });

  it("refuses before any request when the grant cannot write", async () => {
    const { deps, writes } = makeFake("personal", [me], { "me@example.com": [] }, [CALENDAR_LIST_READONLY]);
    const error = await failure(createEvent(deps, "primary", { title: "x", start: "2026-10-02T09:00" }, "none"));
    expect(error).toMatchObject({ kind: "auth", code: "insufficient_scope" });
    expect(writes).toEqual([]);
  });

  it("moves a meeting and keeps its length", async () => {
    const sync: RawEvent = { id: "sync", summary: "Sync", start: { dateTime: "2026-10-02T09:00:00+03:00" }, end: { dateTime: "2026-10-02T09:45:00+03:00" } };
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [sync] });
    const result = await updateEvent(deps, "me@example.com", "sync", { start: "2026-10-02T14:00" }, "none");
    expect(writes[0]?.body).toMatchObject({ end: { dateTime: "2026-10-02T14:45:00+03:00" } });
    expect(result).toMatchObject({ changed: ["start", "end"] });
  });

  it("refuses to change or delete a whole series unless told the series is meant", async () => {
    const weekly: RawEvent = { id: "weekly", summary: "Standup", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"], start: { dateTime: "2026-10-05T09:00:00+03:00" }, end: { dateTime: "2026-10-05T09:15:00+03:00" } };
    const { deps, writes } = makeFake("work", [me], { "me@example.com": [weekly] });
    expect(await failure(updateEvent(deps, "me@example.com", "weekly", { title: "Daily" }, "none"))).toMatchObject({ kind: "input", message: expect.stringMatching(/recurring series/) });
    expect(await failure(deleteEvent(deps, "me@example.com", "weekly", "none"))).toMatchObject({ kind: "input" });
    expect(writes).toEqual([]);
    await updateEvent(deps, "me@example.com", "weekly", { title: "Daily" }, "none", "series");
    expect(writes[0]).toMatchObject({ op: "patch" });
  });

  it("says who a replaced guest list added and removed", async () => {
    const meeting: RawEvent = { id: "m", summary: "Review", attendees: [{ email: "ana@example.com" }, { email: "Ion@Example.com" }] };
    const { deps } = makeFake("work", [me], { "me@example.com": [meeting] });
    const result = await updateEvent(deps, "me@example.com", "m", { attendees: ["ana@example.com", "maria@example.com"] }, "none");
    expect(result).toMatchObject({ guests: { added: ["maria@example.com"], removed: ["ion@example.com"] } });
  });

  it("answers an invitation with my response only", async () => {
    const invite: RawEvent = {
      id: "inv",
      organizer: { email: "hr@acme.example" },
      attendees: [
        { email: "hr@acme.example", organizer: true, responseStatus: "accepted" },
        { email: "me@example.com", self: true, responseStatus: "needsAction" },
      ],
    };
    const { deps, writes } = makeFake("personal", [me], { "me@example.com": [invite] });
    await respondToInvite(deps, "me@example.com", "inv", "accepted", "none");
    expect(writes[0]?.body).toEqual([
      { email: "hr@acme.example", organizer: true, responseStatus: "accepted" },
      { email: "me@example.com", self: true, responseStatus: "accepted" },
    ]);
  });
});

describe("health", () => {
  it("catches a grant approved as the wrong account", async () => {
    const { deps } = makeFake("work", [me], {});
    const h = await checkHealth({ ...deps, address: "me@work.example" });
    expect(h.ok).toBe(false);
    expect(h.problems).toEqual(["the grant resolves to me@example.com, not me@work.example"]);
  });

  it("does not hide a revoked grant", async () => {
    const { deps } = makeFake("work", [me], {});
    const dead: Deps = { ...deps, grant: { ...deps.grant, scopes: async () => fail(authError("invalid_grant", "revoked")) } };
    expect(await failure(checkHealth(dead))).toMatchObject({ kind: "auth", permanent: true });
  });
});

describe("resolveAccounts", () => {
  const fs = (files: Record<string, string>) => ({
    list: (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split("/")[0] as string))],
    read: (path: string) => files[path],
  });

  it("finds each account by its grant file, sorted by name, address from the grant", () => {
    const r = resolveAccounts(
      { CALENDAR_ROOT: "/cal" },
      fs({
        "/cal/work/credentials.json": JSON.stringify({ account: "me@work.example" }),
        "/cal/personal/credentials.json": JSON.stringify({ account: "me@example.com" }),
        "/cal/half-made/state/access_token.json": "{}",
      }),
    );
    expect(r.accounts.map((a) => [a.label, a.address])).toEqual([
      ["personal", "me@example.com"],
      ["work", "me@work.example"],
    ]);
    expect(r.defaultLabel).toBe("personal");
    // The process's zone when CALENDAR_TIME_ZONE is unset (the tests pin TZ to UTC).
    expect(r.timeZone).toBe("UTC");
  });

  it("puts the configured default first, reads dates in CALENDAR_TIME_ZONE, and roots under GOOGLE_STATE_DIR", () => {
    const files = fs({
      "/g/calendar/a/credentials.json": "{}",
      "/g/calendar/b/credentials.json": "{}",
    });
    const r = resolveAccounts({ GOOGLE_STATE_DIR: "/g", CALENDAR_DEFAULT_ACCOUNT: "b", CALENDAR_TIME_ZONE: "Europe/Paris" }, files);
    expect(r.root).toBe("/g/calendar");
    expect(r.accounts.map((a) => a.label)).toEqual(["b", "a"]);
    expect(r.defaultLabel).toBe("b");
    expect(r.timeZone).toBe("Europe/Paris");
  });

  it("is empty, not broken, before the first consent", () => {
    expect(resolveAccounts({ CALENDAR_ROOT: "/cal" }, fs({})).accounts).toEqual([]);
  });
});
