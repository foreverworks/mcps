import { currencyOf, type Dated, formatMinor, keptItemCount, localMoment, REMOVED } from "@foreverworks/receipts/domain";

import { minorOr0, toMinor } from "./money.js";
import type { RawDetails, RawItem, RawPayment, RawSummary } from "./schema.js";

/**
 * Where the money for one order came from, in minor units.
 *
 * `payment_methods` is what was actually taken, and it is the only trustworthy
 * figure: on some grocery orders the legs sum to LESS than `total_price`,
 * because a picker replaced or dropped items after checkout and the card was
 * charged the final amount. `total_price` is never updated to match.
 */
export type Legs = { readonly card: number; readonly boltBalance: number; readonly other: number };

const BOLT_BALANCE = "bolt_credit";
const CARD = "card";

export const legsOf = (details: RawDetails): Legs =>
  (details.payment_methods ?? []).reduce<Legs>(
    (acc, p) => {
      const minor = minorOr0(p.amount?.value);
      if (p.type === CARD) return { ...acc, card: acc.card + minor };
      if (p.type === BOLT_BALANCE) return { ...acc, boltBalance: acc.boltBalance + minor };
      return { ...acc, other: acc.other + minor };
    },
    { card: 0, boltBalance: 0, other: 0 },
  );

const METHOD_NAMES: Readonly<Record<string, string>> = { [CARD]: "card", [BOLT_BALANCE]: "bolt_balance" };

const payment = (p: RawPayment) => ({
  method: METHOD_NAMES[p.type ?? ""] ?? p.type ?? "unknown",
  label: p.title?.value,
  amount: formatMinor(toMinor(p.amount?.value)),
});

/**
 * A picker's change to one line. Bolt marks the dropped original as struck
 * through, and the line that replaced it carries a caption ("Replacement").
 */
const adjustmentOf = (item: RawItem): string | undefined => {
  const adj = item.adjustment;
  if (!adj) return undefined;
  if (adj.is_strike_through_adjusted_item) return REMOVED;
  return adj.original?.text?.text?.value?.toLowerCase() ?? "changed";
};

const lineItem = (item: RawItem) => {
  const lineTotal = toMinor(item.total_item_price?.value);
  const before = item.total_item_price?.original_price?.value;
  const discount = item.total_item_price?.discount_percent ?? 0;
  const adjustment = adjustmentOf(item);
  return {
    name: item.name?.value,
    qty: item.amount ?? 1,
    unitPrice: formatMinor(toMinor(item.unit_item_price?.value)),
    lineTotal: formatMinor(lineTotal),
    ...(before !== undefined && toMinor(before) !== lineTotal
      ? { lineTotalBeforeDiscount: formatMinor(toMinor(before)) }
      : {}),
    ...(discount > 0 ? { discountPercent: discount } : {}),
    options: (item.options ?? []).map((o) => ({
      name: o.name?.value,
      qty: o.amount ?? 1,
      price: formatMinor(toMinor(o.total_item_price?.value)),
    })),
    ...(item.user_note ? { note: item.user_note } : {}),
    ...(adjustment ? { adjustment } : {}),
  };
};

export type ReceiptItem = ReturnType<typeof lineItem>;

/**
 * One order as a receipt: what was bought, what Bolt says it cost, and what was
 * taken from which payment method.
 *
 * `priceLines` are Bolt's own breakdown, verbatim and in Bolt's order. THEY DO
 * NOT SUM TO THE TOTAL, and that is not a parsing bug: "Discount" and "Bolt
 * Plus discount" restate item discounts already inside "Subtotal", and
 * "Packaging fee" is sometimes inside it too. Nothing here re-derives a total
 * from them.
 */
export const toReceipt = (summary: RawSummary, details: RawDetails, timeZone: string) => {
  const currency = currencyOf(details.total_price?.currency ?? summary.price?.currency);
  const created = details.order_created_timestamp ?? summary.order_created_timestamp;
  const when = localMoment(created * 1000, timeZone);
  const legs = legsOf(details);
  const refund = details.refund_amount?.value;

  return {
    orderId: summary.order_id,
    reference: details.order_reference_id,
    provider: details.provider_name?.value ?? summary.provider_name?.value,
    state: details.order_state ?? summary.order_state,
    orderedAt: new Date(created * 1000).toISOString(),
    localDate: when.date,
    localTime: when.time,
    currency,
    items: (details.user_baskets ?? []).flatMap((b) => (b.items ?? []).map(lineItem)),
    priceLines: (details.total_price_components ?? []).map((c) => ({
      kind: c.type,
      label: c.data?.name?.value,
      amount: formatMinor(toMinor(c.data?.amount?.value)),
    })),
    total: formatMinor(toMinor(details.total_price?.value)),
    payments: (details.payment_methods ?? []).map(payment),
    charged: {
      card: formatMinor(legs.card),
      boltBalance: formatMinor(legs.boltBalance),
      ...(legs.other !== 0 ? { other: formatMinor(legs.other) } : {}),
    },
    ...(refund ? { refund: { amount: formatMinor(toMinor(refund)), state: details.order_refund_state } } : {}),
    notices: (details.info_boxes ?? []).flatMap((box) => (box.text?.value ? [box.text.value] : [])),
  };
};

export type Receipt = ReturnType<typeof toReceipt>;

/** The receipt without its lines, for lists where a full receipt per row is too much. */
export const headline = (receipt: Receipt) => ({
  orderId: receipt.orderId,
  provider: receipt.provider,
  localDate: receipt.localDate,
  localTime: receipt.localTime,
  total: receipt.total,
  charged: receipt.charged,
  itemCount: keptItemCount(receipt),
});

/**
 * When a Bolt order happened, as far as its card row is concerned: when it was
 * PLACED, on its local date (the zone the server is configured with, which
 * should be the bank's). A bank that books on the usage day books it then.
 */
export const datedAt = (receipt: Receipt): Dated => ({ at: Date.parse(receipt.orderedAt), date: receipt.localDate });
