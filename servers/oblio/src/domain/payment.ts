import { AMOUNT_SCALE, asAmount, compare, formatDecimal, parseDecimal, placesOf, round, sub, sum, toDecimal, ZERO } from "@foreverworks/mcp-kit";

import { type Collect, type CollectType, type DocumentRef } from "./document.js";
import { fail, inputError } from "./errors.js";
import type { ListedInvoice, Payment } from "./models.js";

/**
 * Recording a payment against an issued invoice: what the caller asks, what
 * the invoice must be for it to make sense, and the plan the call runs on.
 *
 * The plan is made from the invoice as Oblio holds it, read before anything is
 * sent, so the line a person confirms names the invoice's real buyer and
 * currency, and the call records exactly what that line says.
 */

export type CollectRequest = {
  readonly ref: DocumentRef;
  readonly type: CollectType;
  /** In the invoice's currency, a decimal string with at most two decimals. */
  readonly amount: string;
  /** YYYY-MM-DD, the day the money arrived. */
  readonly date: string;
  /** The payment's own reference (OP 7001), required for every type but Chitanta. */
  readonly documentNumber?: string;
  /** The receipt series, required for a Chitanta: Oblio numbers the receipt. */
  readonly receiptSeries?: string;
  readonly mentions?: string;
  /** The caller's own key, for a deliberately identical second payment. */
  readonly idempotencyKey?: string;
};

/** The invoice as the plan saw it, and what it still owed. */
export type Balance = {
  readonly total: string;
  readonly currency: string;
  /** What the payments already recorded add up to. */
  readonly paid: string;
  readonly outstanding: string;
};

export type CollectPlan = {
  readonly ref: DocumentRef;
  readonly client: string;
  readonly companyCif: string;
  readonly balance: Balance;
  readonly payment: Collect;
  /** What the invoice will still owe once this payment is recorded. */
  readonly outstandingAfter: string;
  readonly idempotencyKey: string;
  /** A payment already on the invoice with exactly these fields: nothing will be sent. */
  readonly alreadyRecorded?: Payment;
};

/** What goes to Oblio as the payment, in its own words ("Parametri incasare document"). */
export const paymentOf = (r: CollectRequest): Collect => ({
  type: r.type,
  value: r.amount,
  issueDate: r.date,
  ...(r.documentNumber === undefined ? {} : { documentNumber: r.documentNumber }),
  ...(r.receiptSeries === undefined ? {} : { seriesName: r.receiptSeries }),
  ...(r.mentions === undefined ? {} : { mentions: r.mentions }),
});

/** Total less what the recorded payments add up to, exactly. A payment whose value Oblio did not say counts as nothing. */
export const balanceOf = (invoice: ListedInvoice): Balance => {
  const paid = sum((invoice.collects ?? []).flatMap((c) => (c.value === undefined ? [] : [toDecimal(c.value)])));
  const total = toDecimal(invoice.total);
  return {
    total: asAmount(invoice.total),
    currency: invoice.currency,
    paid: formatDecimal(round(paid, AMOUNT_SCALE, "half-up")),
    outstanding: formatDecimal(round(sub(total, paid), AMOUNT_SCALE, "half-up")),
  };
};

const sameValue = (a: string | undefined, b: string): boolean => {
  const x = a === undefined ? undefined : parseDecimal(a);
  return x !== undefined && compare(x, toDecimal(b)) === 0;
};

const sameText = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? "").replace(/\s+/g, " ").trim().toUpperCase() === (b ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * A payment already recorded with the same type, amount and date, and, unless
 * it is a receipt (whose number Oblio gives), the same reference. This is what
 * makes a retry after a lost answer safe: the payment that landed is found
 * here, and nothing is sent twice.
 */
export const findPayment = (collects: readonly Payment[] | undefined, payment: Collect): Payment | undefined =>
  (collects ?? []).find(
    (c) =>
      sameText(c.type, payment.type) &&
      c.issueDate === payment.issueDate &&
      payment.value !== undefined &&
      sameValue(c.value, payment.value) &&
      (payment.type === "Chitanta" || sameText(c.number, payment.documentNumber)),
  );

/** Why this payment cannot be recorded on this invoice, all at once; empty when it can. */
export const collectRequestProblems = (r: CollectRequest): readonly string[] => {
  const amount = parseDecimal(r.amount);
  return [
    ...(r.type === "Chitanta" && r.receiptSeries === undefined
      ? ["a Chitanta needs receipt_series, the receipt series from list_series; Oblio numbers the receipt"]
      : []),
    ...(r.type !== "Chitanta" && r.documentNumber === undefined
      ? [`a ${r.type} needs document_number, the payment's own reference`]
      : []),
    ...(amount === undefined ? [`amount "${r.amount}" is not a decimal`] : []),
    ...(amount !== undefined && compare(amount, ZERO) <= 0 ? ["amount must be above zero"] : []),
    ...(amount !== undefined && placesOf(r.amount) > AMOUNT_SCALE ? [`amount ${r.amount} has more than ${AMOUNT_SCALE} decimals`] : []),
  ];
};

/** What the invoice itself rules out: a cancelled one, one paid in full, more than it still owes. */
export const payableProblems = (invoice: ListedInvoice, balance: Balance, amount: string): readonly string[] => {
  const outstanding = toDecimal(balance.outstanding);
  if (invoice.cancelled) return [`invoice ${invoice.seriesName} ${invoice.number} is cancelled; a payment cannot be recorded on it`];
  if (compare(outstanding, ZERO) <= 0)
    return [`invoice ${invoice.seriesName} ${invoice.number} is paid in full (${balance.paid} of ${balance.total} ${balance.currency})`];
  return compare(toDecimal(amount), outstanding) > 0
    ? [`amount ${amount} is more than the ${balance.outstanding} ${balance.currency} invoice ${invoice.seriesName} ${invoice.number} still owes`]
    : [];
};

/** What is left to pay after `amount`, exactly. */
export const owedAfter = (balance: Balance, amount: string): string =>
  formatDecimal(round(sub(toDecimal(balance.outstanding), toDecimal(amount)), AMOUNT_SCALE, "half-up"));

export const ensurePayable = (problems: readonly string[]): void => {
  if (problems.length > 0) fail(inputError(`nothing was recorded: ${problems.join("; ")}`));
};
