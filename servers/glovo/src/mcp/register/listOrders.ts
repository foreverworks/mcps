import { compact, type McpServer } from "@foreverworks/mcp-kit";
import type { Handled } from "@foreverworks/receipts/mcp";
import { z } from "zod";

import type { Deps } from "../../app/ports.js";
import { listOrders } from "../../app/usecases/orders.js";

/** Glovo's history has no dates, so its list filters by store and the list's own coarse status. */
export const registerListOrders = (server: McpServer, deps: Deps, handled: Handled): void => {
  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "Past Glovo orders, newest first: store, the app's product summary, listedTotal and a coarse status " +
        "(finished, canceled, refunded, active). Glovo's list has NO dates: a row carries state, localDate and " +
        "localTime only when its details are already stored locally. For dates, use get_receipts. Reads 15 " +
        "orders per call to Glovo, so a rare store filter can take a while.",
      inputSchema: {
        store: z.string().optional().describe("Case-insensitive substring of the store name."),
        status: z.enum(["active", "finished", "canceled", "refunded"]).optional(),
        limit: z.number().int().min(1).max(1000).default(30),
      },
    },
    handled((args: { store?: string | undefined; status?: "active" | "finished" | "canceled" | "refunded" | undefined; limit: number }) =>
      listOrders(deps, compact(args)),
    ),
  );
};
