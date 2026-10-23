import type { McpServer } from "@foreverworks/mcp-kit";
import { registerReceiptTools } from "@foreverworks/receipts/mcp";

import type { Deps } from "../app/ports.js";
import { checkHealth } from "../app/usecases/health.js";
import { getReceipt } from "../app/usecases/orders.js";
import { exportItems, getReceipts, matchCardCharges, orderStats, searchItems } from "../app/usecases/receipts.js";
import { VOCABULARY } from "../domain/errors.js";
import { COPY } from "./register/copy.js";
import { registerListOrders } from "./register/listOrders.js";

/** The whole tool surface: the one every receipts server has, in Bolt's words, with Bolt's list_orders. */
export const registerAll = (server: McpServer, deps: Deps): void =>
  registerReceiptTools(server, deps, {
    copy: COPY,
    vocabulary: VOCABULARY,
    listOrders: registerListOrders,
    health: checkHealth,
    getReceipt,
    useCases: { getReceipts, searchItems, exportItems, matchCardCharges, orderStats },
  });
