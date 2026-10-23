import { makeReceiptUseCases } from "@foreverworks/receipts/app";
import { addDays } from "@foreverworks/receipts/domain";

import { itemRows, rankItems } from "../../domain/items.js";
import { datedAt, headline } from "../../domain/receipt.js";
import { receiptsInRange } from "./details.js";

/** The server's name: its MCP identity, its variables' prefix (GLOVO_*), its export files. */
export const NAME = "glovo";

/**
 * get_receipts, search_items, export_items, match_card_charges and order_stats, which every
 * receipts server has (packages/receipts, app/usecases.ts), bound to Glovo:
 * its undated history walked newest first, its receipt, and its matching
 * anchor, the UTC date of delivery. The walk for matching is one day wider on
 * each side than the window, because it goes by local date and the window by
 * UTC date; a cancelled order that still shows a card leg is a candidate.
 */
export const { getReceipts, searchItems, exportItems, matchCardCharges, orderStats } = makeReceiptUseCases({
  name: NAME,
  receiptsInRange,
  headline,
  itemRows,
  rankItems,
  storeOf: (receipt) => receipt.store,
  matching: {
    filter: (since, until) => ({ since: addDays(since, -1), until: addDays(until, 1) }),
    dated: datedAt,
    searched: (since, until) => ({ deliveryDatesSearched: { since, until }, dateBasis: "UTC date of delivery" }),
  },
});
