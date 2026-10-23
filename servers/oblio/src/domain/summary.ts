import { computable, documentTotal } from "@foreverworks/mcp-kit";

import type { DocumentRef, FromProformaDraft, InvoiceDraft, Party } from "./document.js";
import type { CollectPlan } from "./payment.js";
import type { ReversalPlan } from "./reversal.js";

/**
 * The one line a user confirms before a money call runs, when the server asks
 * (MCP_CONFIRM=elicit).
 *
 * It says exactly what will happen: which document, in which series, to whom,
 * for how much with VAT and in which currency. The amount is documentTotal
 * (the kit's invoiceTotals.ts), the same function whose result the issuing call returns. At most 300
 * characters and never a newline, because that is the confirmation contract.
 */

export const SUMMARY_MAX = 300;

/** One line of plain text: whitespace (newlines included) collapsed, then clipped. */
const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
};

const party = (client: Party): string =>
  `${oneLine(client.name, 70)}${client.cif === undefined ? " (no CIF)" : ` (CIF ${oneLine(client.cif, 20)})`}`;

const ref = (r: DocumentRef): string => `${oneLine(r.seriesName, 20)} ${oneLine(r.number, 20)}`;

const amountOf = (draft: InvoiceDraft): string => {
  // The input schema validates every figure; this guard only keeps a summary
  // from throwing on arguments that somehow skipped it.
  if (!computable(draft.products)) return "an amount that could not be computed";
  const t = documentTotal(draft.products, draft.currency);
  const lines = `${draft.products.length} line${draft.products.length === 1 ? "" : "s"}`;
  return `${t.gross} ${t.currency} incl. VAT ${t.vat} (${lines})`;
};

const collected = (draft: InvoiceDraft): string => {
  const c = draft.collect;
  if (c === undefined) return "";
  const reference = c.documentNumber ?? c.seriesName ?? "";
  return `, marked paid by ${c.type}${reference === "" ? "" : ` ${oneLine(reference, 30)}`}${
    c.value === undefined ? "" : ` for ${c.value} ${draft.currency}`
  }`;
};

export const summarizeInvoice = (draft: InvoiceDraft): string =>
  oneLine(
    `Issue invoice in series ${oneLine(draft.seriesName, 20)} to ${party(draft.client)}: ${amountOf(draft)}, ` +
      `dated ${draft.issueDate ?? "today"}${draft.dueDate === undefined ? "" : `, due ${draft.dueDate}`}` +
      `${collected(draft)}${
        draft.sendEmail === true ? `, emailed by Oblio to ${draft.client.email === undefined ? "the client's saved email" : oneLine(draft.client.email, 60)}` : ""
      }`,
    SUMMARY_MAX,
  );

export const summarizeFromProforma = (draft: FromProformaDraft): string =>
  oneLine(
    `Issue invoice in series ${oneLine(draft.invoiceSeries, 20)} from proforma ${ref(draft.proforma)}: ` +
      "client, lines and total exactly as on that proforma (get_proforma shows them)",
    SUMMARY_MAX,
  );

/** An existing invoice, with the total the caller expects it to have. */
export type ActTarget = { readonly ref: DocumentRef; readonly expectTotal?: string | undefined };

const target = (t: ActTarget): string =>
  `invoice ${ref(t.ref)}${t.expectTotal === undefined ? " (total not given, so not checked)" : ` totalling ${oneLine(t.expectTotal, 20)}`}`;

export const summarizeCancel = (t: ActTarget): string =>
  oneLine(`Cancel ${target(t)}; the number stays used and restore_invoice undoes it`, SUMMARY_MAX);

export const summarizeRestore = (t: ActTarget): string => oneLine(`Restore cancelled ${target(t)} to issued`, SUMMARY_MAX);

export const summarizeDelete = (t: ActTarget): string =>
  oneLine(
    `DELETE ${target(t)} permanently (no undo; only the last number in a series can be deleted, ` +
      "and anything already sent to ANAF stays there)",
    SUMMARY_MAX,
  );

/** How a payment was made, as a person names it: the type and its reference, or a receipt's series. */
const paidBy = (plan: CollectPlan): string =>
  plan.payment.type === "Chitanta"
    ? `Chitanta in series ${oneLine(plan.payment.seriesName ?? "", 20)}`
    : `${plan.payment.type} ${oneLine(plan.payment.documentNumber ?? "", 40)}`;

/**
 * The line for collect_invoice, from the plan the call runs on: the amount and
 * the date are the caller's, the buyer and the currency the invoice's own, read
 * from Oblio before anyone is asked.
 */
export const summarizeCollect = (plan: CollectPlan): string => {
  const what = `${plan.payment.value ?? ""} ${plan.balance.currency} paid on invoice ${ref(plan.ref)} to ${oneLine(plan.client, 70)}, ${paidBy(plan)}, ${plan.payment.issueDate ?? ""}`;
  return oneLine(
    plan.alreadyRecorded === undefined
      ? `Record ${what}, leaving ${plan.outstandingAfter} ${plan.balance.currency} unpaid`
      : `Record nothing: ${what} is already recorded`,
    SUMMARY_MAX,
  );
};

/** What happens to the reversed invoice's payments, when it has any. */
const paymentsFate = (plan: ReversalPlan): string => {
  if (plan.payments === 0) return "";
  const them = plan.payments === 1 ? "the payment" : `the ${plan.payments} payments`;
  return plan.removePayments ? `, removing ${them} recorded on it` : `, keeping ${them} recorded on it`;
};

/**
 * The line for reverse_invoice, from the plan the call runs on: the buyer and
 * the currency are the reversed invoice's own, and the total is reversalTotal
 * (the kit's invoiceTotals.ts), the figure the issued storno is then held to.
 */
export const summarizeReversal = (plan: ReversalPlan): string =>
  oneLine(
    `Issue a reversing invoice for ${ref(plan.ref)}, ${oneLine(plan.client, 70)}, total ${plan.reversalTotal} ${plan.currency}, ` +
      `in series ${oneLine(plan.seriesName, 20)}${paymentsFate(plan)}`,
    SUMMARY_MAX,
  );
