import { type Dated, formatMinor, keptItemCount, localMoment, REMOVED, utcDate } from "@foreverworks/receipts/domain";

import { parseDisplayAmount } from "./money.js";
import { cardLast4, chargedOf, legsOf, paymentView } from "./receipt/payments.js";
import type { RawDetails, RawPriceLine, RawProduct } from "./schema.js";

/** `currentStatus.type` in the words the tools use. Anything unseen passes through lowercased. */
const STATES = {
  DeliveredStatus: "delivered",
  CanceledStatus: "canceled",
  ProgressStatus: "in_progress",
} as const;

type State = (typeof STATES)[keyof typeof STATES];

/** The states a receipt takes, in Glovo's order; also the states a caller can filter by (mcp/register/copy.ts). */
export const RECEIPT_STATES = Object.values(STATES) as [State, ...State[]];

export const stateOf = (details: RawDetails): string => {
  const type = details.currentStatus?.type ?? "";
  return (STATES as Readonly<Record<string, string>>)[type] ?? (type.toLowerCase() || "unknown");
};

/**
 * A picker's change to one line. English and Romanian wording both, because an
 * account set to Romanian gets Romanian text, and a stored payload may have been
 * fetched in it:
 * - removed: displayStyle STRIKETHROUGH, notice "Not available — you weren’t
 *   charged" (ro "Indisponibil — nu ai fost taxat"). The line was not paid for.
 * - replacement: notice "Instead of <original>" (ro "În loc de <original>").
 */
const UNAVAILABLE = /not available|unavailable|indisponibil/i;
const INSTEAD_OF = /^\s*(?:instead of|în loc de)\s+(.+?)\s*$/i;

const adjustmentOf = (p: RawProduct): { adjustment?: typeof REMOVED | "replacement"; replaces?: string } => {
  const notice = p.notice ?? "";
  const replaced = notice.match(INSTEAD_OF)?.[1];
  if (replaced) return { adjustment: "replacement", replaces: replaced };
  if (p.displayStyle === "STRIKETHROUGH" || UNAVAILABLE.test(notice)) return { adjustment: REMOVED };
  return {};
};

const QTY = /^\s*(\d+)\s*x\s*$/i;

const minorOf = (text: string | null | undefined): number | undefined => parseDisplayAmount(text)?.minor;

/**
 * One product line. `price` is Glovo's LINE total, verbatim. It is display
 * data, not arithmetic: on some delivered orders the lines do not sum to the
 * "Products" price line (deposits, weighed goods, promotions), and some
 * promoted lines carry a NEGATIVE price (e.g. "-4,90 RON" on a line whose
 * original price is 36,00). The "Products" line is the authoritative sum.
 */
const lineItem = (p: RawProduct) => {
  const qty = p.quantity?.match(QTY)?.[1];
  const original = minorOf(p.originalPrice);
  return {
    name: p.name ?? undefined,
    qty: qty === undefined ? undefined : Number(qty),
    price: formatMinor(minorOf(p.price)),
    ...(original !== undefined ? { originalPrice: formatMinor(original) } : {}),
    ...(p.promotionDescription ? { promotion: p.promotionDescription } : {}),
    ...(p.customizationsDescription ? { options: p.customizationsDescription } : {}),
    ...(p.packaging ? { packaging: p.packaging } : {}),
    ...(p.freeProduct ? { free: true } : {}),
    ...adjustmentOf(p),
    ...(p.notice ? { notice: p.notice } : {}),
  };
};

export type ReceiptItem = ReturnType<typeof lineItem>;

/**
 * Glovo's breakdown, verbatim and in its order. Unlike Bolt's, these lines DO
 * sum to the total on every delivered order measured. A "No cost" line (a free
 * delivery, e.g. with Prime) is 0.00; a DISCOUNT line is negative and
 * carries its percentage as `tag`.
 */
const priceLine = (l: RawPriceLine) => {
  const final = minorOf(l.finalAmount);
  const tag = l.amountPrefix?.data?.text;
  return {
    kind: l.type,
    label: l.description ?? undefined,
    amount: formatMinor(minorOf(l.amount)),
    ...(final !== undefined ? { finalAmount: formatMinor(final) } : {}),
    ...(tag ? { tag } : {}),
    ...(l.note ? { note: l.note } : {}),
  };
};

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, "").trim();

/**
 * One order as a receipt: what was bought, what Glovo says it cost, and what
 * was taken from which payment method.
 *
 * THERE IS NO ORDER-PLACED TIME. `creationTime` is null on every order; the
 * only timestamp is `currentStatus.creationTime`, the moment the order reached
 * its current state. For a delivered order that is the delivery, and the local
 * date and time are taken from it.
 */
export const toReceipt = (orderId: number, d: RawDetails, timeZone: string) => {
  const lines = d.pricingBreakdown?.lines ?? [];
  const totalLine = lines.find((l) => l.type === "TOTAL");
  const total = parseDisplayAmount(totalLine?.finalAmount ?? totalLine?.amount);
  const currency = total?.currency ?? lines.map((l) => parseDisplayAmount(l.amount)?.currency).find(Boolean);
  const legs = legsOf(d.paymentMethodsBreakdown ?? [], total?.minor);
  const charged = chargedOf(legs);
  const state = stateOf(d);
  const at = d.currentStatus?.creationTime ?? undefined;
  const when = at === undefined ? undefined : localMoment(at, timeZone);
  const last4 = cardLast4(legs);
  const notice = d.headerNotice?.text ? stripTags(d.headerNotice.text) : undefined;

  return {
    orderId: d.id ?? orderId,
    code: d.code ?? undefined,
    store: d.storeName ?? undefined,
    storeId: d.storeId ?? undefined,
    vertical: d.vertical ?? undefined,
    state,
    ...(d.refunded ? { refunded: true } : {}),
    ...(at !== undefined && state === "delivered" ? { deliveredAt: new Date(at).toISOString() } : {}),
    ...(at !== undefined && state === "canceled" ? { canceledAt: new Date(at).toISOString() } : {}),
    localDate: when?.date,
    localTime: when?.time,
    ...(d.scheduledTime ? { scheduledFor: new Date(d.scheduledTime).toISOString() } : {}),
    currency,
    items: (d.boughtProducts ?? []).map(lineItem),
    priceLines: lines.map(priceLine),
    total: formatMinor(total?.minor),
    ...(state === "in_progress" ? { estimated: true } : {}),
    charged: {
      card: formatMinor(charged.card),
      glovoCredit: formatMinor(charged.glovoCredit),
      ...(charged.cash !== 0 ? { cash: formatMinor(charged.cash) } : {}),
      ...(charged.other !== 0 ? { other: formatMinor(charged.other) } : {}),
    },
    ...(last4 ? { cardLast4: last4 } : {}),
    payments: legs.map(paymentView),
    notices: notice ? [notice] : [],
  };
};

export type Receipt = ReturnType<typeof toReceipt>;

/**
 * When a Glovo order happened, as far as its card row is concerned: the only
 * timestamp there is, its delivery (or cancellation), taken as a UTC date. A
 * card is authorised when the order is placed, an hour or so before delivery,
 * so the day before is inside the matching window. An order in progress has
 * no such time and cannot have put a row on the statement yet.
 */
export const datedAt = (r: Receipt): Dated | undefined => {
  const iso = r.deliveredAt ?? r.canceledAt;
  if (iso === undefined) return undefined;
  const at = Date.parse(iso);
  return { at, date: utcDate(at) };
};

/** The receipt without its lines, for lists where a full receipt per row is too much. */
export const headline = (r: Receipt) => ({
  orderId: r.orderId,
  store: r.store,
  vertical: r.vertical,
  state: r.state,
  ...(r.refunded ? { refunded: true } : {}),
  localDate: r.localDate,
  localTime: r.localTime,
  total: r.total,
  charged: r.charged,
  itemCount: keptItemCount(r),
});
