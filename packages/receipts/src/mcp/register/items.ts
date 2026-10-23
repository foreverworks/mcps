import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { localDate } from "../fields.js";
import type { Registrar } from "../tools.js";

export const registerItems: Registrar = (server, deps, tools, handled) => {
  const { copy } = tools;

  server.registerTool(
    "search_items",
    {
      title: "Search items",
      description: copy.searchItems,
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive substring of the product name. Omit to rank everything."),
        since: localDate(deps.timeZone, copy.firstDate).optional(),
        until: localDate(deps.timeZone, copy.lastDate).optional(),
        top: z.number().int().min(1).max(500).default(20),
      },
    },
    handled((args: { query?: string | undefined; since?: string | undefined; until?: string | undefined; top: number }) =>
      tools.useCases.searchItems(deps, compact(args)),
    ),
  );

  server.registerTool(
    "export_items",
    {
      title: "Export items",
      description: copy.exportItems,
      inputSchema: {
        since: localDate(deps.timeZone, copy.firstDate).optional(),
        until: localDate(deps.timeZone, copy.lastDate).optional(),
      },
    },
    handled((args: { since?: string | undefined; until?: string | undefined }) => tools.useCases.exportItems(deps, compact(args))),
  );
};
