import { compact, type McpServer } from "@foreverworks/mcp-kit";
import { type Handled, localDate, stateField } from "@foreverworks/receipts/mcp";
import { z } from "zod";

import type { Deps } from "../../app/ports.js";
import { listOrders } from "../../app/usecases/orders.js";
import { COPY } from "./copy.js";

/** Bolt's history is dated, so its list filters by date, restaurant and state. */
export const registerListOrders = (server: McpServer, deps: Deps, handled: Handled): void => {
  server.registerTool(
    "list_orders",
    {
      title: "List orders",
      description:
        "Past Bolt Food orders, newest first: date, local time, restaurant, state. One cheap call, no products. " +
        "listedPrice is what the app's order list shows; it EXCLUDES the courier tip and is NOT what the card " +
        "was charged. For amounts that join to a bank row, use get_receipt or match_card_charges.",
      inputSchema: {
        since: localDate(deps.timeZone, COPY.firstDate).optional(),
        until: localDate(deps.timeZone, COPY.lastDate).optional(),
        provider: z.string().optional().describe("Case-insensitive substring of the restaurant name."),
        state: stateField(COPY.state),
        limit: z.number().int().min(1).max(1000).default(50),
      },
    },
    handled(
      (args: { since?: string | undefined; until?: string | undefined; provider?: string | undefined; state?: string | undefined; limit: number }) =>
        listOrders(deps, compact(args)),
    ),
  );
};
