import { summaryFrom, type ToolArgs, type ToolPolicy } from "@foreverworks/mcp-kit";

import { planCollect } from "../app/usecases/collect.js";
import { planReversal } from "../app/usecases/reverse.js";
import type { Deps } from "../app/ports.js";

import {
  summarizeCancel,
  summarizeCollect,
  summarizeDelete,
  summarizeFromProforma,
  summarizeInvoice,
  summarizeRestore,
  summarizeReversal,
} from "../domain/summary.js";
import { collectArgs, plannedCollect, toCollectRequest } from "./collectArgs.js";
import { actArgs, fromProformaArgs, invoiceArgs, toFromProformaDraft, toInvoiceDraft, toTarget } from "./documentArgs.js";
import { plannedReversal, reverseArgs, toReversalRequest } from "./reverseArgs.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * `money` is what makes or unmakes a fiscal document: an invoice issued,
 * cancelled, restored or deleted. A proforma is not a fiscal document, so
 * issuing one is a `write`. Each money tool's summary is the ONE line a user
 * confirms when the server asks (MCP_CONFIRM=elicit), computed from the
 * arguments through the same schema and the same exact arithmetic the call
 * itself uses (domain/summary.ts).
 *
 * collect_invoice's and reverse_invoice's lines name the invoice's buyer,
 * currency and total, which only Oblio knows: each `resolve` reads the invoice
 * and makes the plan the line is written from and the call then runs on, so
 * the policy needs the dependencies.
 */

export const policyFor = (deps: Deps): ToolPolicy => ({
  health: { access: "read" },
  list_companies: { access: "read" },
  list_clients: { access: "read" },
  list_products: { access: "read" },
  list_series: { access: "read" },
  list_vat_rates: { access: "read" },
  get_invoice: { access: "read" },
  list_invoices: { access: "read" },
  get_proforma: { access: "read" },
  create_proforma: { access: "write" },
  create_invoice: { access: "money", summary: summaryFrom(invoiceArgs, (a) => summarizeInvoice(toInvoiceDraft(a))) },
  invoice_from_proforma: {
    access: "money",
    summary: summaryFrom(fromProformaArgs, (a) => summarizeFromProforma(toFromProformaDraft(a))),
  },
  cancel_invoice: { access: "money", summary: summaryFrom(actArgs, (a) => summarizeCancel(toTarget(a))) },
  restore_invoice: { access: "money", summary: summaryFrom(actArgs, (a) => summarizeRestore(toTarget(a))) },
  delete_invoice: { access: "money", summary: summaryFrom(actArgs, (a) => summarizeDelete(toTarget(a))) },
  collect_invoice: {
    access: "money",
    resolve: async (args: ToolArgs) => ({ ...args, plan: await planCollect(deps, toCollectRequest(collectArgs.parse(args))) }),
    summary: summaryFrom(plannedCollect, (a) => summarizeCollect(a.plan)),
  },
  reverse_invoice: {
    access: "money",
    resolve: async (args: ToolArgs) => ({ ...args, plan: await planReversal(deps, toReversalRequest(reverseArgs.parse(args))) }),
    summary: summaryFrom(plannedReversal, (a) => summarizeReversal(a.plan)),
  },
});
