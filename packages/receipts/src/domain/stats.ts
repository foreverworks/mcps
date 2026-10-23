import { divideRounded } from "@foreverworks/mcp-kit";

import { currencyOf, formatMinor, parseBankAmount } from "./money.js";
import { DELIVERED, type ReceiptCore } from "./receipt.js";

/**
 * Order statistics: what was paid, per store and per month, over delivered
 * orders. Pure. Amounts stay integer minor units until they are printed, so
 * every total is exact; an average is the one division, rounded once, half up,
 * to the cent.
 *
 * What an order cost is what was TAKEN for it, the sum of its payment legs
 * (`charged`: the card, the app's balance or credits, cash), not the app's
 * own total, which Bolt never updates after a picker drops an item. `card` is
 * the part a bank statement shows. A refund is not subtracted: neither app
 * says when one reached the card.
 */

export type StatLine = { readonly orders: number; readonly paid: string; readonly card: string; readonly average: string };

type Sum = { orders: number; paid: number; card: number; first?: string; last?: string };

/** The order's payment legs in minor units; undefined when one cannot be read, so it is counted apart, never as zero. */
const paymentOf = (receipt: ReceiptCore): { readonly paid: number; readonly card: number } | undefined => {
  const legs = Object.values(receipt.charged).map((v) => (v === undefined ? undefined : parseBankAmount(v)));
  const card = receipt.charged.card === undefined ? undefined : parseBankAmount(receipt.charged.card);
  if (card === undefined || legs.some((l) => l === undefined)) return undefined;
  return { paid: (legs as readonly number[]).reduce((a, b) => a + b, 0), card };
};

const line = (s: Sum): StatLine => ({
  orders: s.orders,
  paid: formatMinor(s.paid),
  card: formatMinor(s.card),
  average: formatMinor(Number(divideRounded(BigInt(s.paid), BigInt(s.orders), "half-up"))),
});

const earlier = (a: string | undefined, b: string | undefined): string | undefined => (a === undefined ? b : b === undefined || a < b ? a : b);
const later = (a: string | undefined, b: string | undefined): string | undefined => (a === undefined ? b : b === undefined || a > b ? a : b);

const added = (sums: Map<string, Sum>, key: string, date: string | undefined, payment: { readonly paid: number; readonly card: number }): void => {
  const s = sums.get(key) ?? { orders: 0, paid: 0, card: 0 };
  const first = earlier(s.first, date);
  const last = later(s.last, date);
  sums.set(key, { orders: s.orders + 1, paid: s.paid + payment.paid, card: s.card + payment.card, ...(first === undefined ? {} : { first }), ...(last === undefined ? {} : { last }) });
};

/** The first and last order dates, where the orders had any. */
const span = (s: Sum) => ({ ...(s.first === undefined ? {} : { first: s.first }), ...(s.last === undefined ? {} : { last: s.last }) });

const keyOf = (...parts: readonly (string | undefined)[]): string => JSON.stringify(parts);
const partsOf = (key: string): readonly (string | null)[] => JSON.parse(key) as (string | null)[];

/**
 * Per currency, per store (the `top` that were paid the most, the currency
 * with the most orders first) and per month, over the delivered orders among
 * `receipts`. A store with no name is null.
 */
export const orderStats = <R extends ReceiptCore>(receipts: readonly R[], storeOf: (receipt: R) => string | undefined, top: number) => {
  const totals = new Map<string, Sum>();
  const stores = new Map<string, Sum>();
  const months = new Map<string, Sum>();
  let unpriced = 0;
  let undated = 0;
  for (const r of receipts) {
    if (r.state !== DELIVERED) continue;
    const payment = paymentOf(r);
    if (payment === undefined) {
      unpriced += 1;
      continue;
    }
    const currency = currencyOf(r.currency);
    const date = r.localDate;
    added(totals, keyOf(currency), date, payment);
    added(stores, keyOf(currency, storeOf(r)), date, payment);
    if (r.localDate === undefined) undated += 1;
    else added(months, keyOf(currency, r.localDate.slice(0, 7)), date, payment);
  }
  // The currency most orders were paid in first; amounts are compared only within one currency.
  const currencies = [...totals].sort(([, a], [, b]) => b.orders - a.orders).map(([key]) => partsOf(key)[0] ?? "");
  const byStore = [...stores]
    .map(([key, s]) => {
      const [currency, store] = partsOf(key);
      return { store: store ?? null, currency: currency ?? "", ...line(s), ...span(s), paidMinor: s.paid };
    })
    .sort(
      (a, b) =>
        currencies.indexOf(a.currency) - currencies.indexOf(b.currency) || b.paidMinor - a.paidMinor || b.orders - a.orders || String(a.store).localeCompare(String(b.store)),
    );
  return {
    delivered: [...totals.values()].reduce((n, s) => n + s.orders, 0) + unpriced,
    totals: currencies.map((currency) => {
      const s = totals.get(keyOf(currency)) as Sum;
      return { currency, ...line(s), ...span(s) };
    }),
    stores: byStore.length,
    byStore: byStore.slice(0, top).map(({ paidMinor: _paid, ...rest }) => rest),
    byMonth: [...months]
      .map(([key, s]) => {
        const [currency, month] = partsOf(key);
        return { month: month ?? "", currency: currency ?? "", ...line(s) };
      })
      .sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency)),
    ...(unpriced > 0 ? { unpriced } : {}),
    ...(undated > 0 ? { undated } : {}),
  };
};
