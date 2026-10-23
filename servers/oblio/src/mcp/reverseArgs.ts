import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { parseRef } from "../domain/document.js";
import type { ReversalPlan, ReversalRequest } from "../domain/reversal.js";
import { ACT_INPUT, INVOICE_INPUT, seriesName } from "./documentArgs.js";

/**
 * reverse_invoice's input: the invoice to reverse, and the two choices Oblio's
 * reference flow leaves (the series of the reversing invoice, and `refund`,
 * whether the reversed invoice's payments are removed).
 */
export const REVERSE_INPUT = {
  ...ACT_INPUT,
  storno_series: seriesName("The series of the reversing invoice")
    .optional()
    .describe("The invoice series the reversing invoice is issued in, from list_series. Default: the reversed invoice's own series."),
  remove_payments: z
    .boolean()
    .default(false)
    .describe(
      "Remove the payments recorded on the reversed invoice (Oblio's refund). Default: keep them, as when the money is " +
        "refunded separately.",
    ),
  idempotency_key: INVOICE_INPUT.idempotency_key.describe(
    "Leave it out: the key is derived from the invoice being reversed, so no retry can reverse it twice. Give one only " +
      "to reverse the same invoice again on purpose, after the first reversal was cancelled.",
  ),
};
export const reverseArgs = z.object(REVERSE_INPUT);
export type ReverseArgs = z.infer<typeof reverseArgs>;

export const toReversalRequest = (a: ReverseArgs): ReversalRequest => ({
  ref: parseRef(a.series_name, a.number),
  removePayments: a.remove_payments,
  ...compact({ seriesName: a.storno_series, expectTotal: a.expect_total, idempotencyKey: a.idempotency_key }),
});

/** The plan the guard attached (policy.ts `resolve`): the storno the line named is the one issued. */
export const reversalPlanIn = (args: object): ReversalPlan | undefined => (args as { readonly plan?: ReversalPlan }).plan;

export const plannedReversal = z.object({ plan: z.custom<ReversalPlan>((v) => typeof v === "object" && v !== null) });
