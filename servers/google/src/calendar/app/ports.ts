/**
 * What the use cases need, named as OPERATIONS rather than endpoints. No URL or
 * query parameter appears above infra/, which is the rule this file keeps.
 */
import type { RawAttendee, RawCalendar, RawEvent } from "../domain/events.js";
import type { RawFreeBusyResponse } from "../domain/schema.js";

export type Window = {
  /** RFC 3339, inclusive. */
  readonly timeMin: string;
  /** RFC 3339, exclusive. */
  readonly timeMax: string;
  readonly query?: string;
  readonly limit: number;
};

/** Whose availability to ask Google for, over which instants. */
export type FreeBusyQuery = {
  /** RFC 3339, inclusive. */
  readonly timeMin: string;
  /** RFC 3339, exclusive. */
  readonly timeMax: string;
  /** Calendar ids or addresses; at most FREEBUSY_MAX_IDS. */
  readonly ids: readonly string[];
};

/** Google refuses a free/busy query naming more calendars than this (tooManyCalendarsRequested). */
export const FREEBUSY_MAX_IDS = 50;

/** Who hears about a write: nobody, or every guest by email. */
export type SendUpdates = "none" | "all" | "externalOnly";

export type CalendarPort = {
  readonly calendars: () => Promise<readonly RawCalendar[]>;
  /** The account's own calendar. Its id IS the account's address, which is how health tells who it is. */
  readonly primary: () => Promise<RawCalendar>;
  /** Recurring series expanded into instances, in start order. */
  readonly events: (calendarId: string, window: Window) => Promise<readonly RawEvent[]>;
  readonly get: (calendarId: string, eventId: string) => Promise<RawEvent>;
  /** Busy periods of calendars the account may see but does not hold events for: other people's. */
  readonly freeBusy: (query: FreeBusyQuery) => Promise<RawFreeBusyResponse>;
  readonly insert: (calendarId: string, body: Record<string, unknown>, sendUpdates: SendUpdates) => Promise<RawEvent>;
  readonly patch: (calendarId: string, eventId: string, body: Record<string, unknown>, sendUpdates: SendUpdates) => Promise<RawEvent>;
  readonly remove: (calendarId: string, eventId: string, sendUpdates: SendUpdates) => Promise<void>;
  readonly respond: (calendarId: string, eventId: string, attendees: readonly RawAttendee[], sendUpdates: SendUpdates) => Promise<RawEvent>;
};

/** The grant an account runs on, described without its secrets. */
export type Grant = {
  readonly credentials: string;
  /** What the issuer said the live token grants. */
  readonly scopes: () => Promise<readonly string[]>;
};

export type Deps = {
  readonly account: string;
  /** The address this account's grant must resolve to, when known. */
  readonly address?: string;
  readonly timeZone: string;
  readonly calendar: CalendarPort;
  readonly grant: Grant;
  readonly now: () => number;
  /** A fresh unique id: what ties a Meet link's creation to one request. */
  readonly newId: () => string;
};

/**
 * Tasks falling due inside an agenda's window, from the accounts the agenda
 * reads: a port the server fills from its Tasks product, so the agenda can
 * show them without Calendar knowing Tasks' grants.
 */
export type TasksDue = (accounts: readonly string[], window: { readonly timeMin: string; readonly timeMax: string; readonly timeZone: string }) => Promise<Readonly<Record<string, unknown>>>;
