import { compact, mapWithConcurrency } from "@foreverworks/mcp-kit";

import { type Column, columnsOf, findColumn } from "../../domain/columns.js";
import { decodeCursors, encodeCursors } from "../../domain/cursor.js";
import { asAppError, fail, inputError } from "../../domain/errors.js";
import { type Row, toRow } from "../../domain/models.js";
import type { RawPage } from "../../domain/schema.js";
import { pickSource } from "../../domain/sources.js";
import { toView, toViewId } from "../../domain/views.js";
import type { Deps, NotionPort } from "../ports.js";
import { databaseOf } from "./databases.js";
import { peopleNames } from "./users.js";

/** Views, data sources and rows read at once: each is its own request against the workspace's pace. */
const CONCURRENCY = 3;
/** Notion's page size ceiling for a view list and a view query. */
const PAGE = 100;
/** Rows one query_view call reads: every row is a request of its own, since a view query answers page ids. */
export const VIEW_ROW_LIMIT = 100;

/** The columns of each data source the views show, read once each. */
const columnsBySource = async (deps: Deps, account: string, ids: readonly string[]): Promise<ReadonlyMap<string, readonly Column[]>> =>
  new Map(await mapWithConcurrency([...new Set(ids)], CONCURRENCY, async (id) => [id, columnsOf(await deps.schema(account, id))] as const));

const sourceOf = (raw: { readonly data_source_id?: string | null }): string | undefined => raw.data_source_id ?? undefined;

/**
 * A database's saved views, each with its name, type, and the filter and sorts
 * a person saved: what "the Active view" means, before query_view runs it.
 * Notion lists views as bare ids, so each is read on its own.
 */
export const listViews = async (deps: Deps, args: { readonly database: string; readonly source?: string; readonly account?: string }) => {
  const { account, database, sourceId: named } = await databaseOf(deps, args.database, args.account);
  const wanted = args.source === undefined ? named : pickSource(database, args.source);
  const api = deps.accounts.api(account);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listViews(database.id, PAGE, cursor);
    ids.push(...page.results.map((r) => r.id));
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  const raws = await mapWithConcurrency(ids, CONCURRENCY, (id) => api.getView(id));
  const columns = await columnsBySource(deps, account, raws.flatMap((r) => ("name" in r ? (sourceOf(r) ?? []) : [])));
  for (const raw of raws) deps.locator.learn(raw.id, account, "view");
  const views = raws
    .map((raw) => toView(raw, ("name" in raw ? columns.get(sourceOf(raw) ?? "") : undefined) ?? []))
    .filter((v) => wanted === undefined || v.dataSourceId === undefined || v.dataSourceId === wanted);
  return compact({ account, database: database.id, source: wanted, views });
};

export type QueryViewArgs = {
  readonly view: string;
  /** Column names to keep in each row; the title always stays. */
  readonly properties?: readonly string[];
  readonly limit: number;
  readonly cursor?: string;
  readonly account?: string;
};

/** Where a view's cached query stands: what query_view's nextCursor carries, opaque to the caller. */
type Position = { readonly view: string; readonly query: string; readonly cursor: string; readonly total: string };

const positionOf = (cursor: string, view: string): Position => {
  const c = decodeCursors(cursor);
  const { view: of, query, cursor: at, total } = c;
  if (of === undefined || query === undefined || at === undefined || total === undefined) return fail(inputError("cursor is not one query_view returned; pass nextCursor exactly as it came back"));
  if (of !== view) return fail(inputError("that cursor reads on another view; pass the view it came with"));
  return { view: of, query, cursor: at, total };
};

/** A row, or its id when the page could not be read (trashed or unshared since the view ran). */
const readRow = async (api: NotionPort, id: string): Promise<RawPage | string> => {
  try {
    return await api.getPage(id);
  } catch (thrown) {
    if (asAppError(thrown)?.kind === "not_shared") return id;
    throw thrown;
  }
};

const keep = (row: Row, names: ReadonlySet<string> | undefined): Row =>
  names === undefined ? row : { ...row, properties: Object.fromEntries(Object.entries(row.properties).filter(([name]) => names.has(name))) };

/**
 * The rows a saved view shows, in its order, with its filter and sorts exactly
 * as Notion applies them (quick filters and "me" included), which where cannot
 * always restate. Notion runs the view once and keeps the result about 15
 * minutes; nextCursor reads on in that same result, so pages do not shift while
 * rows change. A view query answers page ids, so each row is read on its own.
 */
export const queryView = async (deps: Deps, args: QueryViewArgs) => {
  const viewId = toViewId(args.view);
  const found = await deps.locator.find(viewId, ["view"], args.account);
  const { account, view } = found;
  const source = "name" in view ? sourceOf(view) : undefined;
  const columns = source === undefined ? [] : columnsOf(await deps.schema(account, source));
  // The title is each row's own field, so only the other columns are kept or dropped.
  const names = args.properties === undefined ? undefined : new Set(args.properties.map((p) => findColumn(columns, p).name));
  const api = deps.accounts.api(account);
  const limit = Math.min(Math.max(args.limit, 1), VIEW_ROW_LIMIT);

  const ids: string[] = [];
  let query: string;
  let total: string;
  let next: string | undefined;
  let incomplete: string | undefined;
  if (args.cursor === undefined) {
    const first = await api.queryView(viewId, Math.min(limit, PAGE));
    query = first.id;
    total = String(first.total_count);
    ids.push(...first.results.map((r) => r.id));
    next = first.has_more ? (first.next_cursor ?? undefined) : undefined;
    if (first.request_status?.type === "incomplete") incomplete = first.request_status.incomplete_reason ?? "incomplete";
  } else {
    const at = positionOf(args.cursor, viewId);
    query = at.query;
    total = at.total;
    next = at.cursor;
  }
  while (next !== undefined && ids.length < limit) {
    const page = await api.viewQueryPage(viewId, query, Math.min(limit - ids.length, PAGE), next).catch((thrown: unknown) => {
      if (asAppError(thrown)?.kind !== "not_shared") throw thrown;
      return fail(inputError("the view's result has expired (Notion keeps it about 15 minutes): call query_view again without cursor"));
    });
    ids.push(...page.results.map((r) => r.id));
    next = page.has_more ? (page.next_cursor ?? undefined) : undefined;
    if (page.request_status?.type === "incomplete") incomplete = page.request_status.incomplete_reason ?? "incomplete";
  }

  const read = await mapWithConcurrency(ids, CONCURRENCY, (id) => readRow(api, id));
  const people = await peopleNames(deps, account, read.filter((r): r is RawPage => typeof r !== "string"));
  const rows: Row[] = [];
  const unreadable: string[] = [];
  for (const r of read) {
    if (typeof r === "string") {
      unreadable.push(r);
      continue;
    }
    deps.locator.learn(r.id, account, "page");
    rows.push(keep(toRow(r, people), names));
  }
  return compact({
    account,
    view: viewId,
    name: "name" in view ? view.name : undefined,
    source,
    total: Number(total),
    count: rows.length,
    rows,
    unreadable: unreadable.length === 0 ? undefined : unreadable,
    nextCursor: next === undefined ? undefined : encodeCursors({ view: viewId, query, cursor: next, total }),
    incomplete,
  });
};
