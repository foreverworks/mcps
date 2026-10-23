import { makeReceiptUseCases } from "@foreverworks/receipts/app";
import { DELIVERED } from "@foreverworks/receipts/domain";

import { itemRows, rankItems } from "../../domain/items.js";
import { datedAt, headline } from "../../domain/receipt.js";
import { receiptsInRange } from "./details.js";

/** The server's name: its MCP identity, its variables' prefix (BOLT_FOOD_*), its export files. */
export const NAME = "bolt-food";

/**
 * get_receipts, search_items, export_items, match_card_charges and order_stats, which every
 * receipts server has (packages/receipts, app/usecases.ts), bound to Bolt: its
 * dated history, its receipt, and its matching anchor, the time an order was
 * placed. Only delivered orders are candidates for a card row.
 */
export const { getReceipts, searchItems, exportItems, matchCardCharges, orderStats } = makeReceiptUseCases({
  name: NAME,
  receiptsInRange,
  headline,
  itemRows,
  rankItems,
  storeOf: (receipt) => receipt.provider,
  matching: {
    filter: (since, until) => ({ since, until, state: DELIVERED }),
    dated: datedAt,
    searched: (since, until) => ({ orderDatesSearched: { since, until } }),
  },
});
