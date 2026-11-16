import { z } from "zod";

import { downloadInvoice, listInvoices, listTolls, listVehicles, notifications, serviceStatus } from "../../app/usecases/reads.js";
import { from, id, page, size, to } from "../args.js";
import type { Registrar } from "./types.js";

/** The statuses eToll filters tolls by; it answers 400 to PENDING (tried live 2026-11-15). */
const TOLL_STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED", "CONSUMED", "REFUNDED", "DRAFT"] as const;

export const registerReads: Registrar = (server, deps, handled) => {
  server.registerTool(
    "list_vehicles",
    {
      title: "List vehicles",
      description:
        "The cars on the eToll account, each with its rovinietă: valid until which day (Bucharest), how many days are left, and the periods eToll says a new one may " +
        "cover. Start here for \"is my vignette still valid\" and before quote_vignette.",
      inputSchema: {},
    },
    handled(() => listVehicles(deps)),
  );

  server.registerTool(
    "list_tolls",
    {
      title: "List tolls",
      description:
        "The account's vignettes and other tolls (bridge passes), newest first, one page at a time: status, vehicle, period, price in RON, serial. " +
        "Filter by status or plate; pass next_cursor back as cursor for the next page.",
      inputSchema: {
        status: z.enum(TOLL_STATUSES).optional().describe("Only tolls in this status: ACTIVE (valid now or later), EXPIRED, and so on. An unpaid order is not a toll yet; get_order reads one."),
        plate: z.string().trim().min(1).optional().describe("Only tolls for this plate number (spaces and dashes do not matter)."),
        cursor: z.string().trim().min(1).optional().describe("next_cursor from the previous page."),
        size,
      },
    },
    handled((args) => listTolls(deps, args)),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description: "The invoices eToll issued for what the account paid, in a window of days (the last year by default): series and number, date, buyer, total in RON. The id is what download_invoice takes.",
      inputSchema: { from, to, page, size },
    },
    handled((args) => listInvoices(deps, args)),
  );

  server.registerTool(
    "download_invoice",
    {
      title: "Download invoice",
      description: "Save an invoice's PDF in this server's outbox; answers its path, SHA-256 and size, never the bytes.",
      inputSchema: { invoice_id: id("The invoice's id, from list_invoices.") },
    },
    handled((args) => downloadInvoice(deps, { invoiceId: args.invoice_id })),
  );

  server.registerTool(
    "notifications",
    {
      title: "Notifications",
      description: "What eToll has told the account (a vignette about to end, a payment received), and how many are unread.",
      inputSchema: {},
    },
    handled(() => notifications(deps)),
  );

  server.registerTool(
    "service_status",
    {
      title: "Service status",
      description: "CNAIR's public status page for eToll: each component (the portal, payments, the API), open incidents and planned maintenance. Needs no account.",
      inputSchema: {},
    },
    handled(() => serviceStatus(deps)),
  );
};
