import { fetchOne, type Fetched, type ReceiptFilter } from "@foreverworks/receipts/app";
import { addDays, inRange } from "@foreverworks/receipts/domain";

import { asAppError, isSystemic } from "../../domain/errors.js";
import { isSettled } from "../../domain/freshness.js";
import { type Receipt, toReceipt } from "../../domain/receipt.js";
import type { RawListRow } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

/**
 * Details come from the store when the order has settled, from Glovo otherwise.
 * The store only ever holds settled orders, so a stored copy is always good; it
 * holds the RAW payload (packages/receipts, orderStore.ts).
 */
export const receiptFor = async ({ glovo, store, now, timeZone }: Deps, orderId: number): Promise<Receipt> => {
  const cached = await store.read(orderId);
  if (cached) return toReceipt(orderId, cached, timeZone);
  const details = await glovo.orderDetails(orderId);
  if (isSettled(details, now())) await store.write(orderId, details);
  return toReceipt(orderId, details, timeZone);
};

/** Every history row, newest first. Pages are requested only as the caller consumes them. */
export async function* historyRows({ glovo }: Deps): AsyncGenerator<RawListRow> {
  let cursor: string | undefined;
  for (;;) {
    const page = await glovo.historyPage(cursor);
    yield* page.orders;
    if (page.next === undefined || page.orders.length === 0) return;
    cursor = page.next;
  }
}

/**
 * How far past `since` the walk keeps going before it believes the history has
 * left the range. The list is ordered by order id, and the delivery time that
 * dates a receipt was out of that order by at most about an hour in the
 * history measured. A day is generous, and costs a handful of calls.
 */
export const WALK_SLACK_DAYS = 1;

const FAILURES = { asAppError, isSystemic };

/**
 * Receipts for every order whose local date lies in the range (and in the
 * filter's state, when it names one).
 *
 * The history has no dates, so the only way to know where a range starts and
 * ends is to read each order's details, newest first, until one is clearly
 * older than `since`. Orders newer than `until` are read too (and skipped):
 * there is no other way past them. With no `since`, this is the whole history.
 *
 * An order Glovo will not return is reported in place (packages/receipts,
 * fetched.ts); its date is unknown, so it is reported whatever the range.
 */
export const receiptsInRange = async (deps: Deps, filter: ReceiptFilter): Promise<readonly Fetched<Receipt>[]> => {
  const stopBefore = filter.since === undefined ? undefined : addDays(filter.since, -WALK_SLACK_DAYS);
  const out: Fetched<Receipt>[] = [];
  for await (const row of historyRows(deps)) {
    const fetched = await fetchOne(row.orderId, () => receiptFor(deps, row.orderId), FAILURES);
    if (!fetched.ok) {
      out.push(fetched);
      continue;
    }
    const { receipt } = fetched;
    if (receipt.localDate === undefined) {
      out.push({ ok: false, orderId: row.orderId, reason: "the order carries no status time, so it cannot be dated" });
      continue;
    }
    if (stopBefore !== undefined && receipt.localDate < stopBefore) break;
    if (inRange(receipt.localDate, filter) && (filter.state === undefined || receipt.state === filter.state)) out.push(fetched);
  }
  return out;
};
