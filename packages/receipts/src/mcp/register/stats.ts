import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { localDate } from "../fields.js";
import type { Registrar } from "../tools.js";

export const registerStats: Registrar = (server, deps, tools, handled) => {
  const { copy } = tools;

  server.registerTool(
    "order_stats",
    {
      title: "Order statistics",
      description: copy.orderStats,
      inputSchema: {
        since: localDate(deps.timeZone, copy.firstDate).optional(),
        until: localDate(deps.timeZone, copy.lastDate).optional(),
        top: z.number().int().min(1).max(500).default(20).describe("How many stores byStore lists, the most paid first; `stores` counts them all."),
      },
    },
    handled((args: { since?: string | undefined; until?: string | undefined; top: number }) => tools.useCases.orderStats(deps, compact(args))),
  );
};
