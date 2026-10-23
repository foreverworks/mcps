import { fetchOne, type Fetched, type ReceiptFilter } from "@foreverworks/receipts/app";
import { notFound } from "@foreverworks/receipts/domain";

import { asAppError, fail, isSystemic } from "../../domain/errors.js";
import { isSettled } from "../../domain/freshness.js";
import { type Receipt, toReceipt } from "../../domain/receipt.js";
import type { RawSummary } from "../../domain/schema.js";
import { matchesFilter, orderSummary } from "../../domain/summary.js";
import type { Deps } from "../ports.js";

/**
 * Details come from the store when the order has settled, from Bolt otherwise.
 * The store holds the RAW payload (packages/receipts, orderStore.ts).
 */
export const receiptFor = async ({ bolt, store, now, timeZone }: Deps, summary: RawSummary): Promise<Receipt> => {
  const settled = isSettled(summary, now());
  const cached = settled ? await store.read(summary.order_id) : undefined;
  if (cached) return toReceipt(summary, cached, timeZone);

  const details = await bolt.orderDetails(summary.order_id, summary.city_id);
  if (settled) await store.write(summary.order_id, details);
  return toReceipt(summary, details, timeZone);
};

const FAILURES = { asAppError, isSystemic };

/**
 * Many receipts, one at a time: the adapter paces detail calls, so running them
 * concurrently would only queue them there. An order Bolt will not return is
 * reported in place; a dead token stops the batch (packages/receipts, fetched.ts).
 */
export const receiptsFor = async (deps: Deps, summaries: readonly RawSummary[]): Promise<readonly Fetched<Receipt>[]> => {
  const out: Fetched<Receipt>[] = [];
  for (const summary of summaries) out.push(await fetchOne(summary.order_id, () => receiptFor(deps, summary), FAILURES));
  return out;
};

/**
 * Receipts for the orders placed in the filter's range. Bolt's history is
 * dated, so the filter picks the orders before a single detail is fetched.
 */
export const receiptsInRange = async (deps: Deps, filter: ReceiptFilter): Promise<readonly Fetched<Receipt>[]> =>
  receiptsFor(deps, (await deps.bolt.history()).filter((raw) => matchesFilter(orderSummary(raw, deps.timeZone), filter)));

export const findOrder = async ({ bolt }: Deps, orderId: number): Promise<RawSummary> => {
  const summary = (await bolt.history()).find((o) => o.order_id === orderId);
  return summary ?? fail(notFound(`order ${orderId} is not in this account's history`));
};
