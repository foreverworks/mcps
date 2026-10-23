import { addDays, isIsoDate } from "../../domain/dates.js";
import { fail, inputError } from "../../domain/errors.js";
import { type Charge, matchCharges, payableOrder, type PayableOrder, WINDOW } from "../../domain/matching.js";
import { currencyOf, parseBankAmount } from "../../domain/money.js";
import { inRange, MAX_RECEIPT_DAYS, parseRange } from "../../domain/range.js";
import type { ReceiptCore } from "../../domain/receipt.js";
import { type Fetched, unreadable } from "../fetched.js";
import type { CardMatching, Detail, ReceiptFilter } from "../receiptApp.js";
import { atDetail } from "./detail.js";

/** A bank row as booked: `amount` keeps its sign (a debit is negative), `currency` is its ISO code. */
export type ChargeInput = { readonly id: string; readonly date: string; readonly amount: string; readonly currency: string };

export type MatchInput = { readonly charges: readonly ChargeInput[]; readonly detail: Detail };

type Source<D, R, H, W> = {
  readonly receiptsInRange: (deps: D, filter: ReceiptFilter) => Promise<readonly Fetched<R>[]>;
  readonly headline: (receipt: R) => H;
  readonly matching: CardMatching<R, W>;
};

/** A row as the join reads it: a debit (money out, which can have paid an order) or a credit (money in, a refund). */
type Row = { readonly kind: "debit"; readonly charge: Charge } | { readonly kind: "credit"; readonly id: string };

const CURRENCY = /^[A-Za-z]{3}$/;

const toRow = (c: ChargeInput): Row => {
  if (!isIsoDate(c.date)) return fail(inputError(`charge ${c.id}: date must be YYYY-MM-DD, got "${c.date}"`));
  if (!CURRENCY.test(c.currency.trim())) return fail(inputError(`charge ${c.id}: currency must be an ISO 4217 code such as EUR, got "${c.currency}"`));
  const minor = parseBankAmount(c.amount);
  if (minor === undefined) return fail(inputError(`charge ${c.id}: amount "${c.amount}" is not a decimal`));
  if (minor === 0) return fail(inputError(`charge ${c.id}: amount is zero`));
  // The sign is the bank's: a debit is negative. A credit (a refund) paid for nothing, so it pairs with nothing.
  if (minor > 0) return { kind: "credit", id: c.id };
  return { kind: "debit", charge: { id: c.id, date: c.date, amountMinor: -minor, currency: currencyOf(c.currency.trim()) } };
};

type Candidate<R> = { readonly order: PayableOrder; readonly receipt: R };

/**
 * Card rows in, receipts out.
 *
 * Only the orders that COULD pair are read: those dated in the window around
 * the earliest and latest charge. An order is reported as unmatched only when
 * its date lies inside the charges' own span, so an order at the edge of the
 * window, whose card row simply was not sent, is not mistaken for money that
 * went missing.
 */
export const matchCardCharges = async <D, R extends ReceiptCore, H, W extends object>(app: Source<D, R, H, W>, deps: D, input: MatchInput) => {
  if (input.charges.length === 0) fail(inputError("charges is empty"));
  if (new Set(input.charges.map((c) => c.id)).size !== input.charges.length) fail(inputError("charge ids must be unique"));
  const rows = input.charges.map(toRow);
  const charges = rows.flatMap((r) => (r.kind === "debit" ? [r.charge] : []));
  const credits = rows.flatMap((r) => (r.kind === "credit" ? [r.id] : []));
  if (charges.length === 0) {
    fail(inputError("every amount is positive: send debits signed as the bank books them (-42.50); a positive amount is a credit, such as a refund, and pairs with no order"));
  }

  const dates = charges.map((c) => c.date).sort();
  const span = { since: dates[0] as string, until: dates[dates.length - 1] as string };
  parseRange(span.since, span.until, MAX_RECEIPT_DAYS);
  const window = { since: addDays(span.since, -WINDOW.daysAfter), until: addDays(span.until, WINDOW.daysBefore) };

  const fetched = await app.receiptsInRange(deps, app.matching.filter(window.since, window.until));
  const candidates = new Map(
    fetched.flatMap((f): (readonly [number, Candidate<R>])[] => {
      if (!f.ok) return [];
      const order = payableOrder(f.receipt, app.matching.dated(f.receipt));
      return order !== undefined && inRange(order.date, window) ? [[order.orderId, { order, receipt: f.receipt }]] : [];
    }),
  );
  const candidate = (orderId: number) => candidates.get(orderId) as Candidate<R>;

  const result = matchCharges([...candidates.values()].map((c) => c.order), charges);
  const view = atDetail(app.headline, input.detail);

  return {
    matched: result.pairs.map((p) => ({ chargeId: p.chargeId, dayOffset: p.dayOffset, order: view(candidate(p.orderId).receipt) })),
    unmatchedCharges: result.unmatchedCharges,
    credits,
    unmatchedOrders: result.unmatchedOrders
      .filter((id) => inRange(candidate(id).order.date, span))
      .map((id) => app.headline(candidate(id).receipt)),
    unreadableOrders: unreadable(fetched),
    window: { ...app.matching.searched(window.since, window.until), ...WINDOW },
  };
};
