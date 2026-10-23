import { makeHandled, type McpServer } from "@foreverworks/mcp-kit";

import { registerHealth } from "./register/health.js";
import { registerItems } from "./register/items.js";
import { registerMatching } from "./register/matching.js";
import { registerReceipts } from "./register/receipts.js";
import { registerStats } from "./register/stats.js";
import type { ReceiptTools, Zoned } from "./tools.js";

/**
 * The whole tool surface of a receipts server, registered in this order:
 * health, list_orders (the app's own), get_receipt, get_receipts,
 * match_card_charges, search_items, export_items, order_stats (tools/list
 * sorts them by name). Clients call these by name and argument; each
 * server's test/tools.snapshot.json holds them.
 */
export const registerReceiptTools = <D extends Zoned, E extends object>(server: McpServer, deps: D, tools: ReceiptTools<D, E>): void => {
  const handled = makeHandled(tools.vocabulary);
  registerHealth(server, deps, tools, handled);
  tools.listOrders(server, deps, handled);
  registerReceipts(server, deps, tools, handled);
  registerMatching(server, deps, tools, handled);
  registerItems(server, deps, tools, handled);
  registerStats(server, deps, tools, handled);
};
