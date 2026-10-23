import { parseBankAmount, rankItemsBy } from "@foreverworks/receipts/domain";

import type { Receipt } from "./receipt.js";

/** One product line with its order's context, flat enough for a CSV row. */
export const itemRows = (receipt: Receipt) =>
  receipt.items.map((item) => ({
    orderId: receipt.orderId,
    localDate: receipt.localDate ?? "",
    localTime: receipt.localTime ?? "",
    state: receipt.state,
    store: receipt.store ?? "",
    vertical: receipt.vertical ?? "",
    item: item.name ?? "",
    qty: item.qty,
    price: item.price,
    originalPrice: item.originalPrice ?? "",
    promotion: item.promotion ?? "",
    options: item.options ?? "",
    adjustment: item.adjustment ?? "",
    replaces: item.replaces ?? "",
    currency: receipt.currency ?? "",
  }));

export type ItemRow = ReturnType<typeof itemRows>[number];

/**
 * Every product, grouped by store and name (packages/receipts, items.ts). A
 * line with no price, or a NEGATIVE one (Glovo prints those on some promoted
 * lines, e.g. "-4,90 RON"), adds nothing to `spent` rather than a
 * figure that is plainly not what was paid.
 */
export const rankItems = rankItemsBy({
  name: (row: ItemRow) => ({ item: row.item, store: row.store }),
  qty: (row) => row.qty ?? 0,
  spentMinor: (row) => {
    const minor = row.price === undefined ? undefined : parseBankAmount(row.price);
    return minor !== undefined && minor > 0 ? minor : 0;
  },
  latest: (row) => ({ lastPrice: row.price, lastQty: row.qty }),
});
