import { summaryFrom, type ToolArgs, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { prepareOrder } from "../app/usecases/purchase.js";
import { placeInput } from "./controllers/purchase.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: the listings, the status page, health, and quote_vignette, which
 *   asks eToll a price and keeps it here (nothing is ordered); the invoice
 *   download writes into this server's own outbox.
 * - write: the login tools change what the server holds. cancel_order drops
 *   an unpaid order, and declares itself idempotent: an order already gone is
 *   the outcome wanted.
 * - money: place_order creates an order and hands over its payment page. The
 *   card is paid by the user on euplatesc.ro, not here, but the order is the
 *   purchase. The line a person confirms is computed by `resolve` from the
 *   stored quote and the account's billing entry, the same way the order
 *   computes it, so it names the vehicle, the period, the exact price and who
 *   is billed; the order refuses to run if its own line differs.
 */
const resolvedPlace = z.object({ ...placeInput, order_line: z.string().min(1) });

export const policyFor = (deps: Deps): ToolPolicy => ({
  ...policy,
  place_order: {
    access: "money",
    summary: summaryFrom(resolvedPlace, (args) => args.order_line),
    resolve: async (args: ToolArgs) => {
      const quoteId = typeof args["quote_id"] === "string" ? args["quote_id"] : "";
      const billingId = typeof args["billing_id"] === "string" ? args["billing_id"] : undefined;
      const { line } = await prepareOrder(deps, { quoteId, billingId });
      return { ...args, order_line: line };
    },
  },
});

/** Every tool but the one whose confirmation line needs the account (policyFor adds it). */
export const policy: ToolPolicy = {
  health: { access: "read" },
  session_status: { access: "read" },
  begin_login: { access: "write" },
  complete_login: { access: "write" },
  logout: { access: "write" },
  list_vehicles: { access: "read" },
  list_tolls: { access: "read" },
  list_invoices: { access: "read" },
  download_invoice: { access: "read" },
  notifications: { access: "read" },
  service_status: { access: "read" },
  quote_vignette: { access: "read" },
  get_order: { access: "read" },
  cancel_order: { access: "write", idempotent: true },
};
