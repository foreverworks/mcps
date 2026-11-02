import { CALENDAR_EVENTS, CALENDAR_EVENTS_FREEBUSY, CALENDAR_LIST_READONLY } from "../../calendar/domain/grants.js";
import { OPTIONAL_SCOPES as CONTACTS_OPTIONAL, REQUIRED_SCOPES as CONTACTS_REQUIRED } from "../../contacts/domain/grants.js";
import { DRIVE } from "../../domain/scopes.js";
import { NARROW_SCOPES } from "../../editors/domain/grants.js";
import { GMAIL_MODIFY, GMAIL_SETTINGS_BASIC } from "../../gmail/domain/grants.js";
import { REQUIRED_SCOPES as MEET_REQUIRED } from "../../meet/domain/grants.js";
import { REQUIRED_SCOPES as TASKS_REQUIRED } from "../../tasks/domain/grants.js";
import type { ConsentProduct } from "./consent.js";

/**
 * What a consent asks for, per product: the one table both the server's
 * consent and `setup` read, so the scopes setup tells a person to add on the
 * Data Access page are exactly the ones the consent will ask for. Pure.
 *
 *   gmail     gmail.modify, gmail.settings.basic (filters)
 *   calendar  calendar.events, calendar.calendarlist.readonly, calendar.events.freebusy
 *   editors   documents, spreadsheets, presentations, drive.file
 *   drive     drive
 *   tasks     tasks
 *   contacts  contacts.readonly, contacts.other.readonly; directory.readonly optional
 *   meet      meetings.space.readonly
 *
 * Every consent also asks for userinfo.email (consent.ts, requestedScopes).
 */
export type ProductScopes = {
  /** A grant without one of these is refused. */
  readonly required: readonly string[];
  /** Asked for as well; a grant may come back without them (only a Workspace account has a directory). */
  readonly optional: readonly string[];
};

export const CONSENT_SCOPES: Readonly<Record<ConsentProduct, ProductScopes>> = {
  gmail: { required: [GMAIL_MODIFY, GMAIL_SETTINGS_BASIC], optional: [] },
  calendar: { required: [CALENDAR_EVENTS, CALENDAR_LIST_READONLY, CALENDAR_EVENTS_FREEBUSY], optional: [] },
  editors: { required: NARROW_SCOPES, optional: [] },
  drive: { required: [DRIVE], optional: [] },
  tasks: { required: TASKS_REQUIRED, optional: [] },
  contacts: { required: CONTACTS_REQUIRED, optional: CONTACTS_OPTIONAL },
  meet: { required: MEET_REQUIRED, optional: [] },
};

/**
 * The Google APIs each product's tools call, which its Cloud project must
 * enable: what `setup` enables (or links to), by their service names. Docs,
 * Sheets and Slides share one grant whose health checks all three APIs, and
 * they place files in folders through Drive, so the editors need all four.
 * Meet's tools read a calendar event through the Calendar grant, whose API
 * comes with the calendar product.
 */
export const CONSENT_APIS: Readonly<Record<ConsentProduct, readonly string[]>> = {
  gmail: ["gmail.googleapis.com"],
  calendar: ["calendar-json.googleapis.com"],
  editors: ["docs.googleapis.com", "sheets.googleapis.com", "slides.googleapis.com", "drive.googleapis.com"],
  drive: ["drive.googleapis.com"],
  tasks: ["tasks.googleapis.com"],
  contacts: ["people.googleapis.com"],
  meet: ["meet.googleapis.com"],
};
