import { asAmount, compare, parseDecimal, reversalTotal, toDecimal, ZERO } from "@foreverworks/mcp-kit";

import type { DocumentRef } from "./document.js";
import { fail, inputError } from "./errors.js";
import type { ListedInvoice } from "./models.js";

/**
 * Reversing an issued invoice in full (a storno) through Oblio's reference
 * flow: a new invoice that references the old one, its lines negated, its
 * total the old total negated (the kit's `reversalTotal`).
 */

export type ReversalRequest = {
  readonly ref: DocumentRef;
  /** The series the reversing invoice is issued in; the reversed invoice's own when not given. */
  readonly seriesName?: string;
  /** Remove the payments recorded on the reversed invoice (Oblio's `refund`). */
  readonly removePayments: boolean;
  /** The total the caller expects the reversed invoice to have. */
  readonly expectTotal?: string;
  readonly idempotencyKey?: string;
};

export type ReversalPlan = {
  /** The invoice reversed, as Oblio names it. */
  readonly ref: DocumentRef;
  readonly client: string;
  readonly companyCif: string;
  readonly currency: string;
  /** The reversed invoice's total, two decimals. */
  readonly total: string;
  /** The reversing invoice's total: `total`, negated, exactly. */
  readonly reversalTotal: string;
  readonly seriesName: string;
  readonly removePayments: boolean;
  /** How many payments the reversed invoice carries, which `removePayments` decides the fate of. */
  readonly payments: number;
  readonly idempotencyKey: string;
};

/** What the invoice rules out: a cancelled one, one that is itself a reversal, one of another total than expected. */
export const reversalProblems = (invoice: ListedInvoice, expectTotal: string | undefined): readonly string[] => {
  const name = `invoice ${invoice.seriesName} ${invoice.number}`;
  const total = toDecimal(invoice.total);
  const expected = expectTotal === undefined ? undefined : parseDecimal(expectTotal);
  return [
    ...(invoice.cancelled ? [`${name} is cancelled; restore it first, or leave it cancelled instead of reversing it`] : []),
    ...(compare(total, ZERO) <= 0 ? [`${name} totals ${invoice.total}, so it is a reversal itself or a zero invoice; nothing to reverse`] : []),
    ...(expectTotal !== undefined && (expected === undefined || compare(expected, total) !== 0)
      ? [`${name} totals ${invoice.total}, not the expected ${expectTotal}`]
      : []),
  ];
};

export const ensureReversible = (problems: readonly string[]): void => {
  if (problems.length > 0) fail(inputError(`no reversing invoice was issued: ${problems.join("; ")}`));
};

/** The plan's figures, from the invoice as Oblio holds it. The key is the caller's, or derived by the use case. */
export const reversalOf = (
  invoice: ListedInvoice,
  request: ReversalRequest,
  companyCif: string,
  idempotencyKey: string,
): ReversalPlan => ({
  ref: { seriesName: invoice.seriesName, number: invoice.number },
  client: invoice.client?.name ?? "a buyer the invoice does not name",
  companyCif,
  currency: invoice.currency,
  total: asAmount(invoice.total),
  reversalTotal: reversalTotal(invoice.total),
  seriesName: request.seriesName ?? invoice.seriesName,
  removePayments: request.removePayments,
  payments: invoice.collects?.length ?? 0,
  idempotencyKey,
});
