import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool of a receipts server, classified (packages/mcp-kit, policy.ts).
 * All of them read the order history; export_items also writes a file into the
 * server's own exports directory, which changes nothing outside the server.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  list_orders: { access: "read" },
  get_receipt: { access: "read" },
  get_receipts: { access: "read" },
  search_items: { access: "read" },
  export_items: { access: "read" },
  match_card_charges: { access: "read" },
  order_stats: { access: "read" },
};
