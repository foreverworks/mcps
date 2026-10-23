import { daysBetween } from "./dates.js";
import { parseBankAmount } from "./money.js";
import type { ReceiptCore } from "./receipt.js";

/**
 * Pairing delivery orders with the card rows that paid for them. Three rules
 * carry it:
 *
 * 1. JOIN ON THE CARD LEG, not the order total. An order can be part-paid from
 *    an in-app balance (Bolt Balance, Glovo credits), and the card only ever
 *    sees the remainder, so matching on the total misses every such order.
 * 2. A WINDOW OF [-1, +2] DAYS from the order's date to the booking date.
 *    Some banks book on the usage day; the slack is for a bank that books on
 *    settlement instead, and for Glovo, whose only timestamp is the delivery,
 *    an hour or so after the card was authorised. What "the order's date" is
 *    belongs to each app (bolt-food: the local date it was placed; glovo: the
 *    UTC date it was delivered).
 * 3. CLAIM GREEDILY IN TIME ORDER, earliest candidate first. Two orders of the
 *    same amount on one day are almost always two real orders, and this resolves
 *    them to two rows instead of letting both claim the first.
 *
 * And only a DEBIT pairs: a row comes in with the bank's sign, and a credit (a
 * refund of exactly an order's amount, days later) is set aside before this
 * runs, so it can never claim the order it refunds. Currencies must agree.
 */
export const WINDOW = { daysBefore: 1, daysAfter: 2 } as const;

export type Charge = {
  readonly id: string;
  readonly date: string;
  /** The debit's size: a card row that paid an order took this much. */
  readonly amountMinor: number;
  readonly currency: string;
};

/** When an order happened, for matching: the instant that orders claims, and the date a card row is compared with. */
export type Dated = { readonly at: number; readonly date: string };

export type PayableOrder = Dated & {
  readonly orderId: number;
  readonly cardMinor: number;
  readonly currency: string;
};

export type Pair = { readonly chargeId: string; readonly orderId: number; readonly dayOffset: number };

export type MatchResult = {
  readonly pairs: readonly Pair[];
  readonly unmatchedCharges: readonly string[];
  readonly unmatchedOrders: readonly number[];
};

/**
 * The order a card row could pair with, or undefined when no card row can
 * exist for it: nothing on the card (paid from credits or cash, or cancelled
 * before a charge), a card leg that cannot be known, no currency, or no date.
 */
export const payableOrder = (receipt: ReceiptCore, dated: Dated | undefined): PayableOrder | undefined => {
  const card = receipt.charged.card === undefined ? undefined : parseBankAmount(receipt.charged.card);
  if (dated === undefined || card === undefined || card <= 0 || !receipt.currency) return undefined;
  return { orderId: receipt.orderId, at: dated.at, date: dated.date, cardMinor: card, currency: receipt.currency };
};

const inWindow = (offset: number): boolean => offset >= -WINDOW.daysBefore && offset <= WINDOW.daysAfter;

/** Pure from the outside; the accumulators are local to one call. */
export const matchCharges = (orders: readonly PayableOrder[], charges: readonly Charge[]): MatchResult => {
  const claimed = new Set<string>();
  const pairs: Pair[] = [];
  const unmatchedOrders: number[] = [];

  const byTime = [...orders].filter((o) => o.cardMinor > 0).sort((a, b) => a.at - b.at);
  const byDate = [...charges].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const order of byTime) {
    const hit = byDate.find(
      (c) =>
        !claimed.has(c.id) &&
        c.amountMinor === order.cardMinor &&
        c.currency === order.currency &&
        inWindow(daysBetween(order.date, c.date)),
    );
    if (!hit) {
      unmatchedOrders.push(order.orderId);
      continue;
    }
    claimed.add(hit.id);
    pairs.push({ chargeId: hit.id, orderId: order.orderId, dayOffset: daysBetween(order.date, hit.date) });
  }

  return { pairs, unmatchedCharges: charges.filter((c) => !claimed.has(c.id)).map((c) => c.id), unmatchedOrders };
};
