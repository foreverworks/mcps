import { compact } from "@foreverworks/mcp-kit";

import { present } from "../present.js";
import type { RawPropertyValue } from "../schema.js";
import { plainText } from "../text.js";
import type { PeopleNames } from "../users.js";

/**
 * A page's property values as the plainest thing that loses nothing an agent
 * needs: a select is its option's name, a relation its page ids, a date its
 * start and end. Colours, option ids and rich-text annotations stay behind.
 *
 * Numbers are the JSON numbers Notion sent. This server does no arithmetic on
 * them; a column that holds money is shown, never summed.
 */

export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

type AnyUser = { readonly id: string; readonly name?: string | null };

/** A person as `{id, name}`; a page that answered the id alone gets the name from the workspace's users, when the caller has them. */
const person = (user: AnyUser, names: PeopleNames | undefined): Json => compact({ id: user.id, name: user.name ?? names?.get(user.id) ?? undefined });

type RawDate = { readonly start: string; readonly end: string | null; readonly time_zone: string | null } | null;

const date = (value: RawDate): Json =>
  value === null ? null : compact({ start: value.start, end: value.end ?? undefined, timeZone: value.time_zone ?? undefined });

/**
 * The value, or undefined for a property that has none to show (a button).
 * A type this code does not know yet comes out as its type name in angle
 * brackets rather than disappearing, so a new Notion type is visible.
 */
export const readValue = (raw: RawPropertyValue, names?: PeopleNames): Json | undefined => {
  switch (raw.type) {
    case "title":
      return plainText(raw.title);
    case "rich_text":
      return plainText(raw.rich_text);
    case "number":
      return raw.number;
    case "url":
      return raw.url;
    case "email":
      return raw.email;
    case "phone_number":
      return raw.phone_number;
    case "select":
      return raw.select?.name ?? null;
    case "status":
      return raw.status?.name ?? null;
    case "multi_select":
      return raw.multi_select.map((o) => o.name);
    case "date":
      return date(raw.date);
    case "checkbox":
      return raw.checkbox;
    case "files":
      return raw.files.map((f) =>
        f.type === "file" ? { name: f.name, url: f.file.url, expiresAt: f.file.expiry_time } : { name: f.name, url: f.external.url },
      );
    case "people":
      return raw.people.map((p) => person(p as AnyUser, names));
    case "relation":
      return raw.relation.map((r) => r.id);
    case "created_by":
      return person(raw.created_by as AnyUser, names);
    case "last_edited_by":
      return person(raw.last_edited_by as AnyUser, names);
    case "created_time":
      return raw.created_time;
    case "last_edited_time":
      return raw.last_edited_time;
    case "formula": {
      const f = raw.formula;
      switch (f.type) {
        case "string":
          return f.string;
        case "number":
          return f.number;
        case "boolean":
          return f.boolean;
        case "date":
          return date(f.date);
        default:
          return null;
      }
    }
    case "rollup": {
      const r = raw.rollup;
      switch (r.type) {
        case "number":
          return r.number;
        case "date":
          return date(r.date);
        case "array":
          // An array item is a property value without its id, which nothing here reads.
          return r.array.map((item) => readValue(item as RawPropertyValue, names) ?? null);
        default:
          return null;
      }
    }
    case "unique_id":
      return raw.unique_id.number === null
        ? null
        : raw.unique_id.prefix
          ? `${raw.unique_id.prefix}-${raw.unique_id.number}`
          : raw.unique_id.number;
    case "verification":
      return raw.verification === null ? null : compact({ state: raw.verification.state, ...("date" in raw.verification ? { date: date(raw.verification.date ?? null) ?? undefined } : {}) });
    case "place":
      return raw.place === null
        ? null
        : compact({ lat: raw.place.lat, lon: raw.place.lon, name: raw.place.name ?? undefined, address: raw.place.address ?? undefined });
    case "button":
      return undefined;
    default:
      return `<${(raw as { type: string }).type}>`;
  }
};

/** Nothing to show: an empty text, no selection, no date, an empty list. */
export const isEmpty = (value: Json | undefined): boolean =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

export type ReadProperties = {
  /** By column name. Empty values are left out: the schema (describe_database) lists every column. */
  readonly values: Readonly<Record<string, Json>>;
  /**
   * Relation columns whose page object listed only the first 25 pages
   * (`has_more`), by name and property id, for the caller to fetch in full.
   */
  readonly truncated: readonly { readonly name: string; readonly propertyId: string }[];
};

export const readProperties = (properties: Readonly<Record<string, RawPropertyValue | null>>, names?: PeopleNames): ReadProperties => {
  const values: Record<string, Json> = {};
  const truncated: { name: string; propertyId: string }[] = [];
  for (const [name, raw] of present(properties)) {
    const value = readValue(raw, names);
    if (!isEmpty(value)) values[name] = value as Json;
    if (raw.type === "relation" && (raw as { readonly has_more?: boolean }).has_more === true) truncated.push({ name, propertyId: raw.id });
  }
  return { values, truncated };
};

/** A page's title: the value of its one title property. */
export const pageTitle = (properties: Readonly<Record<string, RawPropertyValue | null>>): string => {
  const title = present(properties).find(([, p]) => p.type === "title")?.[1];
  return title?.type === "title" ? plainText(title.title) : "";
};
