import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { listDatabaseTemplates, countRows, describeDatabase, queryDatabase } from "../../app/usecases/databases.js";
import { account, cursor, database, inTrash, match, notionFilter, sort, source, where, whereAgain } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const DESCRIBE = { database, account };

const QUERY = {
  database,
  source,
  where,
  match,
  notion_filter: notionFilter,
  sort,
  properties: z.array(z.string().trim().min(1)).optional().describe("The columns to return, by name; the title always comes back. Default: all."),
  limit: z.number().int().min(1).max(1000).default(100).describe("Rows to return; more than 100 are read 100 at a time."),
  cursor,
  in_trash: inTrash,
  account,
};

const COUNT = {
  database,
  source,
  where: whereAgain,
  match,
  notion_filter: notionFilter,
  by: z.string().trim().min(1).optional().describe("A column to count by: rows per option, per value, per related page."),
  in_trash: inTrash,
  account,
};

export const registerDatabases: Registrar = (server, deps) => {
  const templates = { database, source, account, cursor, limit: z.number().int().min(1).max(100).default(100) };
  server.registerTool("list_database_templates", {
    title: "List database templates",
    description: "The page templates of a database or data source, with their page ids, names and default flags. Use this catalog to distinguish templates from ordinary rows; search can return both. Inspect their pages before editing recurring content. Follow nextCursor when hasMore is true.",
    inputSchema: templates,
  }, handled((args: ArgsOf<typeof templates>) => listDatabaseTemplates(deps, { database: args.database, limit: args.limit, ...compact({ source: args.source, account: args.account, cursor: args.cursor }) })));

  server.registerTool(
    "describe_database",
    {
      title: "Describe a database",
      description:
        "A database's columns: name, type, the options of a select, multi-select or status (with a status's groups), " +
        "where a relation points, a formula's expression. Read it before writing where, sort or properties: every one " +
        "of those names these columns. A database holding several tables (data sources) lists each.",
      inputSchema: DESCRIBE,
    },
    handled((args: ArgsOf<typeof DESCRIBE>) => describeDatabase(deps, { database: args.database, ...compact({ account: args.account }) })),
  );

  server.registerTool(
    "query_database",
    {
      title: "Query a database",
      description:
        "Rows of a database, filtered by where (checked against the columns first), sorted, with the columns asked " +
        "for. Each row is its id, its title and its non-empty columns as plain values. A relation lists its first 25 " +
        "pages here (truncated names it); read_page lists them all. nextCursor reads on; Notion stops one query at 10,000 " +
        "rows (incomplete says so). Works on the Free plan, unlike the hosted connector's SQL query.",
      inputSchema: QUERY,
    },
    handled((args: ArgsOf<typeof QUERY>) =>
      queryDatabase(deps, {
        database: args.database,
        where: args.where,
        match: args.match,
        sort: args.sort,
        limit: args.limit,
        inTrash: args.in_trash,
        ...compact({
          source: args.source,
          notionFilter: args.notion_filter,
          properties: args.properties,
          cursor: args.cursor,
          account: args.account,
        }),
      }),
    ),
  );

  server.registerTool(
    "count_rows",
    {
      title: "Count rows",
      description:
        'How many rows match where, and with by, how many hold each value of one column ("how many tasks per ' +
        'status"), most first; an empty value counts as "(empty)", and a multi-select row counts once per option. ' +
        "Reads the matching rows without sending them, up to Notion's 10,000 per query.",
      inputSchema: COUNT,
    },
    handled((args: ArgsOf<typeof COUNT>) =>
      countRows(deps, {
        database: args.database,
        where: args.where,
        match: args.match,
        inTrash: args.in_trash,
        ...compact({ source: args.source, notionFilter: args.notion_filter, by: args.by, account: args.account }),
      }),
    ),
  );
};
