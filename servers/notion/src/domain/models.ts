import { compact } from "@foreverworks/mcp-kit";

import { type Column, columnsOf, titleOf } from "./columns.js";
import { type Json, pageTitle, readProperties } from "./properties/read.js";
import { present } from "./present.js";
import type { RawComment, RawDatabase, RawDataSource, RawPage, RawParent, RawSearchHit } from "./schema.js";
import { plainText } from "./text.js";
import type { PeopleNames } from "./users.js";

/**
 * What the tools answer with, built from Notion's objects. Compact on purpose:
 * the text lands in a model's context, so colours, icons, covers and empty
 * values stay behind, and a URL is sent only where a person may open it
 * (urlOf in ids.ts rebuilds one from any id).
 */

/** Where an object sits. A row's parent is its database; `dataSourceId` names the table inside it. */
export type Parent = {
  readonly type: "page" | "database" | "block" | "workspace";
  readonly id?: string;
  readonly dataSourceId?: string;
};

export const parentOf = (parent: RawParent | { readonly type: string }): Parent => {
  const p = parent as { type: string; page_id?: string; database_id?: string; data_source_id?: string; block_id?: string };
  switch (p.type) {
    case "data_source_id":
      return compact({ type: "database" as const, id: p.database_id, dataSourceId: p.data_source_id });
    case "database_id":
      return compact({ type: "database" as const, id: p.database_id });
    case "page_id":
      return compact({ type: "page" as const, id: p.page_id });
    case "block_id":
      return compact({ type: "block" as const, id: p.block_id });
    default:
      return { type: "workspace" };
  }
};

export type Page = {
  readonly account: string;
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly parent: Parent;
  readonly created: string;
  readonly edited: string;
  readonly inTrash?: true;
  readonly locked?: true;
  /** By column name, empty values left out. */
  readonly properties: Readonly<Record<string, Json>>;
};

export const toPage = (account: string, raw: RawPage, properties: Readonly<Record<string, Json>>): Page => ({
  account,
  id: raw.id,
  url: raw.url,
  title: pageTitle(raw.properties),
  parent: parentOf(raw.parent),
  created: raw.created_time,
  edited: raw.last_edited_time,
  ...(raw.in_trash ? { inTrash: true as const } : {}),
  ...(raw.is_locked ? { locked: true as const } : {}),
  properties,
});

/** One row of a query: the title on its own, every other non-empty column by name. */
export type Row = {
  readonly id: string;
  readonly title: string;
  readonly properties: Readonly<Record<string, Json>>;
  /** Relation columns that list only their first 25 pages here; read_page lists them all. */
  readonly truncated?: readonly string[];
  readonly inTrash?: true;
};

export const toRow = (raw: RawPage, names?: PeopleNames): Row => {
  const { values, truncated } = readProperties(raw.properties, names);
  const titleName = present(raw.properties).find(([, v]) => v.type === "title")?.[0];
  const properties = Object.fromEntries(Object.entries(values).filter(([name]) => name !== titleName));
  return {
    id: raw.id,
    title: pageTitle(raw.properties),
    properties,
    ...(truncated.length > 0 ? { truncated: truncated.map((t) => t.name) } : {}),
    ...(raw.in_trash ? { inTrash: true as const } : {}),
  };
};

/** A search result. A database is found through its data source; both ids come back, either one works everywhere. */
export type Hit = {
  readonly account: string;
  readonly kind: "page" | "database";
  readonly id: string;
  readonly title: string;
  readonly parent?: Parent;
  readonly edited?: string;
  readonly dataSourceId?: string;
};

export const toHit = (account: string, raw: RawSearchHit): Hit => {
  if (raw.object === "page") {
    return "properties" in raw
      ? { account, kind: "page", id: raw.id, title: pageTitle(raw.properties), parent: parentOf(raw.parent), edited: raw.last_edited_time }
      : { account, kind: "page", id: raw.id, title: "" };
  }
  if (!("parent" in raw)) return { account, kind: "database", id: raw.id, title: "" };
  const parent = raw.parent as { type: string; database_id?: string };
  return compact({
    account,
    kind: "database" as const,
    id: parent.database_id ?? raw.id,
    title: titleOf(raw),
    parent: parentOf(raw.database_parent),
    edited: raw.last_edited_time,
    dataSourceId: parent.database_id === undefined ? undefined : raw.id,
  });
};

/** A column as describe_database shows it: no ids, which no tool needs, since every tool takes names. */
export type ColumnModel = Omit<Column, "id">;

export type Source = { readonly id: string; readonly name: string; readonly columns: readonly ColumnModel[] };

export type Database = {
  readonly account: string;
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly parent: Parent;
  readonly inTrash?: true;
  /** The tables in it. Almost always one; a query or a new row in a database with several names one by `source`. */
  readonly sources: readonly Source[];
};

export const toSource = (raw: RawDataSource): Source => ({
  id: raw.id,
  name: titleOf(raw),
  columns: columnsOf(raw).map(({ id: _id, ...column }) => column),
});

export const toDatabase = (account: string, raw: RawDatabase, sources: readonly RawDataSource[]): Database => ({
  account,
  id: raw.id,
  title: plainText(raw.title),
  url: raw.url,
  parent: parentOf(raw.parent),
  ...(raw.in_trash ? { inTrash: true as const } : {}),
  sources: sources.map(toSource),
});

export type Comment = {
  readonly id: string;
  readonly discussionId: string;
  readonly created: string;
  /** The name Notion shows for it; the author's user id when it shows none. */
  readonly author: string;
  readonly text: string;
};

export const toComment = (raw: RawComment): Comment => ({
  id: raw.id,
  discussionId: raw.discussion_id,
  created: raw.created_time,
  author: raw.display_name.resolved_name ?? raw.created_by.id,
  text: plainText(raw.rich_text),
});
