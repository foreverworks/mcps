import type { CalendarPort, FreeBusyQuery, SendUpdates, Window } from "../app/ports.js";
import type { RawAttendee, RawCalendar, RawEvent } from "../domain/events.js";
import type { RawFreeBusyRequest, RawFreeBusyResponse } from "../domain/schema.js";
import type { Request } from "../../infra/httpJson.js";

/** The only file that knows Calendar's URLs and parameter names. */
const BASE = "https://www.googleapis.com/calendar/v3";

const enc = encodeURIComponent;
const eventsUrl = (calendarId: string) => `${BASE}/calendars/${enc(calendarId)}/events`;
const eventUrl = (calendarId: string, eventId: string) => `${eventsUrl(calendarId)}/${enc(eventId)}`;

/**
 * Version 1 is what makes Google act on conferenceData (a new Meet link); at
 * the default, 0, it ignores the field. Sent only with a body that carries one,
 * so no other write changes how Google treats an event's existing call.
 */
const conferenceVersion = (body: Record<string, unknown>) => (body["conferenceData"] !== undefined ? { conferenceDataVersion: 1 } : {});

/** Google's page cap for events.list. Larger pages are refused, not clamped. */
const PAGE_MAX = 2500;

type Page<T> = { readonly items?: readonly T[]; readonly nextPageToken?: string };

export const makeCalendarApi = (request: Request): CalendarPort => {
  const calendars = async (): Promise<readonly RawCalendar[]> => {
    const all: RawCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const page = await request<Page<RawCalendar>>(`${BASE}/users/me/calendarList`, {
        query: { maxResults: 250, pageToken },
      });
      all.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  };

  const events = async (calendarId: string, window: Window): Promise<readonly RawEvent[]> => {
    const all: RawEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = await request<Page<RawEvent>>(eventsUrl(calendarId), {
        query: {
          timeMin: window.timeMin,
          timeMax: window.timeMax,
          // Instances, not series: an agenda is about Tuesday's standup, not the rule that makes it.
          singleEvents: "true",
          orderBy: "startTime",
          q: window.query,
          maxResults: Math.min(PAGE_MAX, window.limit),
          pageToken,
        },
      });
      all.push(...(page.items ?? []));
      pageToken = all.length < window.limit ? page.nextPageToken : undefined;
    } while (pageToken);
    return all;
  };

  /**
   * A POST that only reads, so it is safe to retry like a GET. No `timeZone`:
   * Google then answers in UTC instants, which is all the domain reads.
   */
  const freeBusy = (query: FreeBusyQuery): Promise<RawFreeBusyResponse> => {
    const body: RawFreeBusyRequest = { timeMin: query.timeMin, timeMax: query.timeMax, items: query.ids.map((id) => ({ id })) };
    return request<RawFreeBusyResponse>(`${BASE}/freeBusy`, { method: "POST", json: body, idempotent: true });
  };

  return {
    calendars,
    primary: () => request<RawCalendar>(`${BASE}/users/me/calendarList/primary`),
    events,
    get: (calendarId, eventId) => request<RawEvent>(eventUrl(calendarId, eventId)),
    freeBusy,
    insert: (calendarId, body, sendUpdates: SendUpdates) =>
      request<RawEvent>(eventsUrl(calendarId), { method: "POST", json: body, query: { sendUpdates, ...conferenceVersion(body) }, idempotent: false }),
    patch: (calendarId, eventId, body, sendUpdates: SendUpdates) =>
      request<RawEvent>(eventUrl(calendarId, eventId), { method: "PATCH", json: body, query: { sendUpdates, ...conferenceVersion(body) } }),
    remove: async (calendarId, eventId, sendUpdates: SendUpdates) => {
      await request<undefined>(eventUrl(calendarId, eventId), { method: "DELETE", query: { sendUpdates } });
    },
    respond: (calendarId, eventId, attendees: readonly RawAttendee[], sendUpdates: SendUpdates) =>
      request<RawEvent>(eventUrl(calendarId, eventId), { method: "PATCH", json: { attendees }, query: { sendUpdates } }),
  };
};
