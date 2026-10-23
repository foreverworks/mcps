import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { listViews, queryView, VIEW_ROW_LIMIT } from "../../app/usecases/views.js";
import { account, cursor, database, source } from "../args.js";
import { handled } from "../envelope.js";
import { VIEWS_OUTPUT } from "../outputs.js";
import type { ArgsOf, Registrar } from "./types.js";

const LIST = { database, source, account };

const QUERY = {
  view: z.string().trim().min(1).describe("The view: its id from list_views, or the view's own Notion link (it carries ?v=)."),
  properties: z.array(z.string().trim().min(1)).optional().describe("The columns to keep in each row, by name; the title always comes back. Default: all."),
  limit: z.number().int().min(1).max(VIEW_ROW_LIMIT).default(25).describe("Rows to return. Each row is one more request, so read a long view in pages."),
  cursor,
  account,
};

/** Saved views: the filters and orders a person set up in Notion, listed and run as they are. */
export const registerViews: Registrar = (server, deps) => {
  server.registerTool(
    "list_views",
    {
      title: "List a database's views",
      description:
        "A database's saved views (table, board, calendar, ...): each one's id, name, type, the table it shows, and the filter " +
        "and sorts saved in it, in Notion's query grammar with columns by name. Use it to find the view a person means " +
        '("my Open tasks"), then query_view to read its rows exactly as Notion shows them.',
      inputSchema: LIST,
      outputSchema: VIEWS_OUTPUT,
    },
    handled((args: ArgsOf<typeof LIST>): Promise<OutputOf<typeof VIEWS_OUTPUT>> => listViews(deps, { database: args.database, ...compact({ source: args.source, account: args.account }) })),
  );

  server.registerTool(
    "query_view",
    {
      title: "Query a saved view",
      description:
        "The rows a saved view shows, in its order, filtered and sorted exactly as Notion applies the view (quick filters " +
        "and 'me' included), with total, the number of rows the view holds. Each row is its id, title and non-empty columns " +
        "as query_database answers them. Notion keeps a view's result about 15 minutes: nextCursor reads on in that same " +
        "result, and after that a new call without cursor starts again. A view takes no extra filter: for that, " +
        "query_database with where.",
      inputSchema: QUERY,
    },
    handled((args: ArgsOf<typeof QUERY>) =>
      queryView(deps, { view: args.view, limit: args.limit, ...compact({ properties: args.properties, cursor: args.cursor, account: args.account }) }),
    ),
  );
};
