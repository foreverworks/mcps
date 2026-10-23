import { parseBankAmount, rankItemsBy } from "@foreverworks/receipts/domain";

import type { Receipt } from "./receipt.js";

/** One product line with its order's context, flat enough for a CSV row. */
export const itemRows = (receipt: Receipt) =>
  receipt.items.map((item) => ({
    orderId: receipt.orderId,
    localDate: receipt.localDate,
    localTime: receipt.localTime,
    state: receipt.state,
    provider: receipt.provider,
    item: item.name,
    qty: item.qty,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    lineTotalBeforeDiscount: item.lineTotalBeforeDiscount ?? item.lineTotal,
    discountPercent: item.discountPercent ?? 0,
    options: item.options.map((o) => `${o.qty}x ${o.name}`).join(" | "),
    adjustment: item.adjustment ?? "",
    note: item.note ?? "",
    currency: receipt.currency,
  }));

export type ItemRow = ReturnType<typeof itemRows>[number];

/**
 * Every product, grouped by restaurant and name (packages/receipts, items.ts).
 * `lastUnitPrice` is optional: a line Bolt sent no price for has none, and a
 * line Bolt sent no total for adds nothing to `spent`, rather than poisoning
 * the sum with a figure nobody reported.
 */
export const rankItems = rankItemsBy({
  name: (row: ItemRow) => ({ item: row.item, provider: row.provider }),
  qty: (row) => row.qty,
  spentMinor: (row) => (row.lineTotal === undefined ? undefined : parseBankAmount(row.lineTotal)) ?? 0,
  latest: (row) => ({ lastUnitPrice: row.unitPrice }),
});
