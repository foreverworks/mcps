import { MAX_RECEIPT_DAYS } from "@foreverworks/receipts/domain";
import type { ReceiptCopy, StateCopy } from "@foreverworks/receipts/mcp";

import { RECEIPT_STATES } from "../../domain/receipt.js";

/**
 * Glovo's words for the shared tools (packages/receipts, mcp/tools.ts). Word
 * for word what a client reads: test/tools.snapshot.json holds them.
 */

const SLOW =
  "Needs every order's details: without `since`, the first run on a cold store reads the whole history " +
  "(minutes for a long history: about 1.4 orders per second at Glovo's safe pace); later runs read the local store.";

/** What the server tells a client at initialize, before any tool description. */
export const INSTRUCTIONS =
  "A Glovo account's order history as itemised receipts, read-only: nothing here orders, pays or changes the " +
  "account. Start with health: whether the sign-in works, and the latest order. list_orders lists orders by " +
  "store or status, without dates; get_receipts reads every order delivered in a date range, and get_receipt one. " +
  "To explain bank statement rows, pass them to match_card_charges exactly as the bank booked them: each debit " +
  "comes back with the order it paid for. search_items and export_items cover every product ever ordered, and " +
  "order_stats what the orders cost per store and per month; their first run on a cold store reads every order's " +
  "details and takes minutes. Amounts are decimal strings, and " +
  "charged.card is what the bank statement shows.";

export const STATES: StateCopy = {
  values: RECEIPT_STATES,
  description: "Only orders in this state. Only 'delivered' orders were received; a canceled one may still show a card leg.",
};

/** The descriptions, with dates named in the zone the server reads them in. */
export const copyFor = (timeZone: string): ReceiptCopy => ({
  health:
    "Check that the integration is alive: mints a real access token, reads the first page of order history " +
    "and the newest order's details, and reports the Glovo user id, the latest order, and how many order " +
    "details are stored locally. Run this before concluding the MCP is broken.",
  getReceipt:
    "One order as an itemised receipt: store, vertical (FOOD or Q_COMMERCE), state, delivery time and " +
    `local date (${timeZone}); every product with quantity, line price, original price and promotion; lines a picker ` +
    "removed or replaced (adjustment); Glovo's price lines verbatim (they sum to the total); the total; and " +
    "what each payment leg was charged. charged.card is the amount on the bank statement (Apple Pay counts " +
    "as card, cash does not). Amounts are decimal strings.",
  getReceipts:
    `Receipts for every order whose delivery (or cancellation) date lies in a range of at most ${MAX_RECEIPT_DAYS} days. ` +
    "Glovo's history has no dates, so this reads each order's details from the newest down until it passes " +
    "the range: about 1.4 orders per second on a cold store, instant for orders stored after a week. An " +
    "order Glovo will not return is reported as {partial: true} instead of failing the batch.",
  searchItems:
    "Every product ever ordered, grouped by store and name, most-ordered first: times ordered, quantity, " +
    `total spent, first and last date, latest line price. Delivered orders only; removed lines excluded. ${SLOW}`,
  exportItems:
    "Write one CSV row per product line (every state, with order id, date, store, vertical, prices, promotion, " +
    `options, adjustment) to the server's exports directory and return its path, SHA-256 and size. ${SLOW}`,
  matchCardCharges:
    "Pair bank card rows with the Glovo orders they paid for, and return each pair with its receipt. " +
    "Send the rows exactly as the bank booked them, debits negative, each with its currency. A debit pairs " +
    "with an order when its amount equals the order's CARD leg (the total minus any Glovo credits) and the " +
    "booking date is 1 day before to 2 days after the UTC date the order was delivered (Glovo keeps no " +
    "order-placed time); same-amount orders are claimed in time order. Returns matched pairs, debits nothing " +
    "claimed (not Glovo, or the monthly Prime fee), credits (refunds, which pair with nothing), and card-paid " +
    "orders inside the charges' date span that no charge claimed. On " +
    "Romanian statements Glovo shows as 'Glovo', 'Glovoappro S.r.l.' or 'Glovo <ddmon> <code>'; 'Glovo Prime' is the subscription.",
  orderStats:
    "What delivered orders cost, per store and per month: orders, paid (every payment leg: card, Glovo credit, cash, " +
    "other), card (what the bank statement shows) and the average per order, exact decimals, per currency. " +
    "byStore lists the stores paid the most (null when Glovo gave no name); refunds are not subtracted. Without " +
    `dates it covers the whole history. ${SLOW}`,
  firstDate: "First date",
  lastDate: "Last date",
  detail:
    "'headline' = store, vertical, state, date, total and the card / Glovo credits split. " +
    "'full' = the whole receipt: every product with original price, promotion and picker adjustments, " +
    "Glovo's price lines, payment legs, notices.",
  state: STATES,
});
