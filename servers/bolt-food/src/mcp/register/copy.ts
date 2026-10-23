import { MAX_RECEIPT_DAYS } from "@foreverworks/receipts/domain";
import type { ReceiptCopy, StateCopy } from "@foreverworks/receipts/mcp";

import { FINAL_STATES } from "../../domain/freshness.js";

/**
 * Bolt Food's words for the shared tools (packages/receipts, mcp/tools.ts).
 * Word for word what a client reads: test/tools.snapshot.json holds them.
 */

const SLOW =
  "Needs every order's details: without a date range, the first run on a cold store fetches two to three " +
  "orders a second, so a long history takes minutes; later runs read the local store.";

/** What the server tells a client at initialize, before any tool description. */
export const INSTRUCTIONS =
  "A Bolt Food account's order history as itemised receipts, read-only: nothing here orders, pays or changes the " +
  "account. Start with health: whether the sign-in works, and how many orders the history holds. list_orders " +
  "finds orders by date, restaurant or state; get_receipt reads one in full, and get_receipts every order in a " +
  "date range. To explain bank statement rows, pass them to match_card_charges exactly as the bank booked them: " +
  "each debit comes back with the order it paid for. search_items and export_items cover every product ever " +
  "ordered, and order_stats what the orders cost per restaurant and per month; their first run on a cold store " +
  "reads every order's details and takes minutes. Amounts are decimal " +
  "strings, and charged.card is what the bank statement shows.";

export const STATES: StateCopy = {
  values: FINAL_STATES,
  description: "Only orders in this state. Only 'delivered' orders were paid for and kept.",
};

export const COPY: ReceiptCopy = {
  health:
    "Check that the integration is alive: mints a real access token, reads the order history, and reports " +
    "the Bolt user id, when the refresh token expires (and whether that is soon), the order count, the latest " +
    "order, and how many order details are stored locally. Run this before concluding the MCP is broken.",
  getReceipt:
    "One order as an itemised receipt: every product with quantity, unit and line price, pre-discount price, " +
    "options and notes; items a grocery picker replaced or removed (adjustment); Bolt's price lines " +
    "(subtotal, fees, tips, discounts) verbatim; the total; and what each payment method was charged. " +
    "charged.card is the amount that appears on the bank statement. priceLines are Bolt's display and do " +
    "not sum to the total. Amounts are decimal strings.",
  getReceipts:
    `Receipts for every order placed in a date range (at most ${MAX_RECEIPT_DAYS} days). ` +
    "Order details are fetched one at a time, two to three per second, and stored once an order has been " +
    "final for a week, so only the first read of a range waits on Bolt. An order Bolt will not return is " +
    "reported as {partial: true} instead of failing the batch.",
  searchItems:
    "Every product ever ordered, grouped by restaurant and name, most-ordered first: times ordered, quantity, " +
    `total spent, first and last date, latest unit price. Delivered orders only; removed grocery lines excluded. ${SLOW}`,
  exportItems:
    "Write one CSV row per product line (every state, with order id, date, restaurant, prices, discount, " +
    `options, adjustment) to the server's exports directory and return its path, SHA-256 and size. ${SLOW}`,
  matchCardCharges:
    "Pair bank card rows with the Bolt Food orders they paid for, and return each pair with its receipt. " +
    "Send the rows exactly as the bank booked them, debits negative, each with its currency. A debit pairs " +
    "with a delivered order when its amount equals the order's CARD leg (the total minus any Bolt Balance " +
    "used) and the booking date is 1 day before to 2 days after the order's local date; same-amount orders " +
    "are claimed in time order. Returns matched pairs, debits nothing claimed (not Bolt Food), credits " +
    "(refunds, which pair with nothing), and card-paid orders inside the charges' date span that no charge claimed. On Romanian statements 'Bolt Services Ro S.r.l.' " +
    "is Bolt Food; 'bolt.eu/o/...' and 'Payu*bolt.eu' are rides and will not match.",
  orderStats:
    "What delivered orders cost, per restaurant and per month: orders, paid (every payment leg: card, Bolt Balance, " +
    "other), card (what the bank statement shows) and the average per order, exact decimals, per currency. " +
    "byStore lists the restaurants paid the most (store is the restaurant's name, null when Bolt gave none); refunds " +
    `are not subtracted. Without dates it covers the whole history. ${SLOW}`,
  firstDate: "First order date",
  lastDate: "Last order date",
  detail:
    "'headline' = provider, date, total and the card / Bolt Balance split. " +
    "'full' = the whole receipt: every product with options and discounts, Bolt's price lines, payments, refunds, notices.",
  state: STATES,
};
