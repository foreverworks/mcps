import { compact } from "@foreverworks/mcp-kit";

import type { Column } from "./columns.js";
import { fail, inputError } from "./errors.js";
import { parseId } from "./ids.js";
import type { RawView } from "./schema.js";

/**
 * A database's saved views (a table, a board, a calendar...), each with the
 * filter and sorts a person saved in Notion. Notion answers a view's filter in
 * its query grammar with each column named by its id; the names are put back
 * here from the data source's columns, so a view reads the way where and
 * describe_database do.
 */

const BARE = /^[0-9a-f]{32}$/i;

/**
 * A view's id: given as is, or from a Notion link to the view, which carries it
 * in `?v=` (the path names the database). A database link without `?v=` names
 * no view, and is refused with how to get one.
 */
export const toViewId = (input: string): string => {
  const raw = input.trim();
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {
    url = undefined;
  }
  if (url === undefined) return parseId(raw) ?? fail(inputError(`view "${input}" is not a view id or a link to a view`));
  const v = url.searchParams.get("v")?.replace(/-/g, "");
  if (v !== undefined && BARE.test(v)) return parseId(v) as string;
  return fail(inputError("that link names a database, not one of its views: copy the view's own link in Notion (it carries ?v=), or take an id from list_views"));
};

export type View = {
  readonly id: string;
  /** Absent only when Notion answers a partial view, its id and type alone. */
  readonly name?: string;
  /** table, board, list, calendar, timeline, gallery, form, chart, map or dashboard. */
  readonly type: string;
  /** The table it shows, in a database that holds several. */
  readonly dataSourceId?: string;
  readonly url?: string;
  /** The saved filter, in Notion's query grammar, columns by name. */
  readonly filter?: Readonly<Record<string, unknown>>;
  /** The saved order, first key first. */
  readonly sorts?: readonly unknown[];
};

/** A column id as Notion writes it in a view, or decoded: both name the same column. */
const decoded = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/** `property` keys holding a column id, with the column's name in their place; anything else as it was. */
export const namedColumns = (value: unknown, columns: readonly Column[]): unknown => {
  if (Array.isArray(value)) return value.map((v) => namedColumns(v, columns));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if (key !== "property" || typeof inner !== "string") return [key, namedColumns(inner, columns)];
      const column = columns.find((c) => c.id === inner || decoded(c.id) === decoded(inner) || c.name === inner);
      return [key, column?.name ?? inner];
    }),
  );
};

export const toView = (raw: RawView, columns: readonly Column[]): View => {
  if (!("name" in raw)) return { id: raw.id, type: raw.type };
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    ...compact({
      dataSourceId: raw.data_source_id ?? undefined,
      url: raw.url,
      // An object in, an object out: namedColumns keeps the shape and renames values only.
      filter: raw.filter === null || raw.filter === undefined ? undefined : (namedColumns(raw.filter, columns) as Readonly<Record<string, unknown>>),
      sorts: raw.sorts === null || raw.sorts === undefined || raw.sorts.length === 0 ? undefined : (namedColumns(raw.sorts, columns) as readonly unknown[]),
    }),
  };
};
