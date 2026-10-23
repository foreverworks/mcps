import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { COLLECT_TYPES, parseRef } from "../domain/document.js";
import type { CollectPlan, CollectRequest } from "../domain/payment.js";
import { decimalText, INVOICE_INPUT, isoDate, REF_INPUT, seriesName, text } from "./documentArgs.js";

/**
 * collect_invoice's input: Oblio's "Parametri incasare factura" with the
 * payment's own fields ("Parametri incasare document"), in this server's
 * snake_case. The amount and the date are required: Oblio's defaults (the
 * whole total, today) are exactly what a person should not confirm unseen.
 */
export const COLLECT_INPUT = {
  ...REF_INPUT,
  type: z.enum(COLLECT_TYPES).describe('How it was paid, in Oblio\'s words: "Ordin de plata" for a bank transfer, "Card", "Chitanta" for cash with a receipt, and so on.'),
  amount: decimalText("Amount paid").describe(
    'The amount paid, in the invoice\'s currency, as a decimal STRING ("1210.00"), at most two decimals and at most what the invoice still owes.',
  ),
  date: isoDate("The day it was paid"),
  document_number: text(60).optional().describe('The payment\'s own reference ("OP 7001"), required for every type but Chitanta.'),
  receipt_series: seriesName("The receipt series").optional().describe("For a Chitanta: the receipt series from list_series. Oblio numbers the receipt."),
  mentions: text(500).optional(),
  idempotency_key: INVOICE_INPUT.idempotency_key.describe(
    "Leave it out: a retry with the same arguments then finds the payment if it landed and records nothing. Give a key " +
      "of your own only to record a second payment identical in type, reference, amount and date.",
  ),
};
export const collectArgs = z.object(COLLECT_INPUT);
export type CollectArgs = z.infer<typeof collectArgs>;

export const toCollectRequest = (a: CollectArgs): CollectRequest => ({
  ref: parseRef(a.series_name, a.number),
  type: a.type,
  amount: a.amount,
  date: a.date,
  ...compact({
    documentNumber: a.document_number,
    receiptSeries: a.receipt_series,
    mentions: a.mentions,
    idempotencyKey: a.idempotency_key,
  }),
});

/** The plan the guard attached (policy.ts `resolve`): the payment the line named is the one that is sent. */
export const collectPlanIn = (args: object): CollectPlan | undefined => (args as { readonly plan?: CollectPlan }).plan;

export const plannedCollect = z.object({ plan: z.custom<CollectPlan>((v) => typeof v === "object" && v !== null) });
