import { settledSince } from "@foreverworks/receipts/domain";

import type { RawDetails } from "./schema.js";

/**
 * Whether a stored detail can be trusted forever (packages/receipts,
 * freshness.ts): a week in a final status. A refund (`refunded: true`, and a
 * header notice naming the amount) lands on the same order id later. Glovo
 * stamps the status change in epoch MILLISECONDS; an order with no such stamp
 * never settles.
 */
export const FINAL_STATUSES: ReadonlySet<string> = new Set(["DeliveredStatus", "CanceledStatus"]);

export const isSettled = (details: RawDetails, nowMs: number): boolean => {
  const at = details.currentStatus?.creationTime;
  return FINAL_STATUSES.has(details.currentStatus?.type ?? "") && typeof at === "number" && settledSince(at, nowMs);
};
