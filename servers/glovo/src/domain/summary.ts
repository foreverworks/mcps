import { formatMinor } from "@foreverworks/receipts/domain";

import { parseDisplayAmount } from "./money.js";
import type { RawListRow } from "./schema.js";

/**
 * An order-history card. It carries the store, the app's one-line product
 * summary and a footer, and NOTHING else: no date, no state, no payment split.
 *
 * The footer is either the order total (it matched the detail TOTAL on every
 * delivered and in-progress order compared) or a word: "Cancelled"
 * (ro "Anulat") or "Refunded" (ro "Rambursat"). `status` is read from that and
 * from `layoutType`; it is the list's own coarse view, and a receipt's `state`
 * is the authoritative one.
 */
export type ListStatus = "active" | "finished" | "canceled" | "refunded" | "unknown";

const CANCELED = /cancel|anulat/i;
const REFUNDED = /refund|rambursat/i;

const statusOf = (row: RawListRow, priced: boolean): ListStatus => {
  if (row.layoutType === "ACTIVE_ORDER") return "active";
  if (priced) return "finished";
  const footer = row.footer?.left?.data ?? "";
  if (CANCELED.test(footer)) return "canceled";
  if (REFUNDED.test(footer)) return "refunded";
  return "unknown";
};

export const orderSummary = (row: RawListRow) => {
  const price = parseDisplayAmount(row.footer?.left?.data);
  const products = row.content?.body?.map((b) => b.data).find((t) => typeof t === "string" && t.length > 0);
  return {
    orderId: row.orderId,
    store: row.content?.title ?? undefined,
    status: statusOf(row, price !== undefined),
    ...(price !== undefined ? { listedTotal: formatMinor(price.minor), currency: price.currency } : {}),
    ...(products ? { products } : {}),
  };
};

export type OrderSummary = ReturnType<typeof orderSummary>;
