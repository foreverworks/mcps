import { compact, mapWithConcurrency } from "@foreverworks/mcp-kit";

import { columnsOf, findColumn } from "../../domain/columns.js";
import { required } from "../../domain/errors.js";
import { toId } from "../../domain/ids.js";
import { type Row, toDatabase, toRow } from "../../domain/models.js";
import { isEmpty, type Json, readValue } from "../../domain/properties/read.js";
import { PAGE_LIMIT, planQuery, type QueryArgs } from "../../domain/query.js";
import { present } from "../../domain/present.js";
import type { RawDatabase, RawPage, RawQuery } from "../../domain/schema.js";
import { pickSource } from "../../domain/sources.js";
import type { Deps, NotionPort } from "../ports.js";
import { peopleNames, resolvePeople } from "./users.js";

/** Data sources read at once when a database holds several. */
const SOURCE_CONCURRENCY = 3;

/**
 * A database named by its own id or by one of its data sources' ids (search
 * answers both; a URL holds the database's). Either way the answer is about the
 * database, and the table a call means is picked by `source`.
 */
export const databaseOf = async (deps: Deps, database: string, account: string | undefined): Promise<{ readonly account: string; readonly database: RawDatabase; readonly sourceId?: string }> => {
  const found = await deps.locator.find(toId(database, "database"), ["database", "data_source"], account);
  switch (found.kind) {
    case "database":
      return { account: found.account, database: found.database };
    case "data_source": {
      const parent = found.source.parent as { readonly database_id?: string };
      const db = await deps.accounts.api(found.account).getDatabase(required(parent.database_id, "database_id of the data source"));
      return { account: found.account, database: db, sourceId: found.source.id };
    }
  }
};

/** Its tables and every column of each: names, types, options, where relations point. */
export const describeDatabase = async (deps: Deps, args: { readonly database: string; readonly account?: string }) => {
  const { account, database } = await databaseOf(deps, args.database, args.account);
  const sources = await mapWithConcurrency(database.data_sources, SOURCE_CONCURRENCY, (s) => deps.schema(account, s.id));
  return toDatabase(account, database, sources);
};

export type QueryDatabaseArgs = QueryArgs & { readonly database: string; readonly source?: string; readonly account?: string };

/** Up to `limit` rows, a page of 100 at a time, and the cursor after the last one read. */
const readRows = async (api: NotionPort, sourceId: string, plan: ReturnType<typeof planQuery>, limit: number) => {
  const pages: RawPage[] = [];
  let cursor = plan.cursor;
  let last: RawQuery | undefined;
  do {
    last = await api.query(sourceId, { ...plan, pageSize: Math.min(PAGE_LIMIT, limit - pages.length), ...(cursor === undefined ? {} : { cursor }) });
    for (const r of last.results) if (r.object === "page" && "properties" in r) pages.push(r);
    cursor = last.has_more ? (last.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined && pages.length < limit);
  const incomplete = last.request_status?.type === "incomplete" ? (last.request_status.incomplete_reason ?? "incomplete") : undefined;
  return { pages, cursor, incomplete };
};

/** Rows of one table, filtered, sorted, with the columns asked for. */
export const queryDatabase = async (deps: Deps, args: QueryDatabaseArgs) => {
  const { account, database, sourceId: named } = await databaseOf(deps, args.database, args.account);
  const sourceId = args.source === undefined && named !== undefined ? named : pickSource(database, args.source);
  const columns = columnsOf(await deps.schema(account, sourceId));
  const plan = planQuery(columns, { ...args, where: await resolvePeople(deps, account, columns, args.where) });
  const { pages, cursor, incomplete } = await readRows(deps.accounts.api(account), sourceId, plan, args.limit);
  const names = await peopleNames(deps, account, pages);
  const rows: Row[] = pages.map((p) => {
    deps.locator.learn(p.id, account, "page");
    return toRow(p, names);
  });
  return compact({ account, database: database.id, source: sourceId, count: rows.length, rows, nextCursor: cursor, incomplete });
};

export type CountArgs = Omit<QueryArgs, "properties" | "limit" | "cursor" | "sort"> & {
  readonly database: string;
  readonly source?: string;
  readonly account?: string;
  /** A column whose values to count rows by. */
  readonly by?: string;
};

/**
 * How many rows match, and how many hold each value of `by` ("how many tasks
 * per status"), answered without sending the rows. Reads every matching row,
 * only the title and `by` columns, up to Notion's 10,000 per query.
 */
export const countRows = async (deps: Deps, args: CountArgs) => {
  const { account, database, sourceId: named } = await databaseOf(deps, args.database, args.account);
  const sourceId = args.source === undefined && named !== undefined ? named : pickSource(database, args.source);
  const columns = columnsOf(await deps.schema(account, sourceId));
  const by = args.by === undefined ? undefined : findColumn(columns, args.by);
  const where = await resolvePeople(deps, account, columns, args.where);
  const plan = planQuery(columns, { ...args, where, sort: [], properties: by === undefined ? [] : [by.name], limit: PAGE_LIMIT });
  const { pages, incomplete } = await readRows(deps.accounts.api(account), sourceId, plan, 10_000);
  const counts: Record<string, number> = {};
  if (by !== undefined) {
    const names = await peopleNames(deps, account, pages);
    for (const page of pages) {
      const raw = present(page.properties).find(([, p]) => p.id === by.id)?.[1];
      const value: Json | undefined = raw === undefined ? undefined : readValue(raw, names);
      const keys = isEmpty(value) ? ["(empty)"] : Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))) : [typeof value === "string" ? value : JSON.stringify(value)];
      for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return compact({
    account,
    database: database.id,
    source: sourceId,
    total: pages.length,
    by: by?.name,
    counts: by === undefined ? undefined : Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])),
    incomplete,
  });
};

/** The catalog distinguishes reusable templates from ordinary rows, even when search returns both. */
export const listDatabaseTemplates = async (deps: Deps, args: { readonly database: string; readonly source?: string; readonly account?: string; readonly limit: number; readonly cursor?: string }) => {
  const { account, database, sourceId: named } = await databaseOf(deps, args.database, args.account);
  const sourceId = args.source === undefined && named !== undefined ? named : pickSource(database, args.source);
  const result = await deps.accounts.api(account).listTemplates(sourceId, args.limit, args.cursor);
  return compact({ account, database: database.id, source: sourceId, templates: result.templates, hasMore: result.has_more, nextCursor: result.next_cursor ?? undefined });
};
