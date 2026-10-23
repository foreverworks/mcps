import { settledSince } from "@foreverworks/receipts/domain";

import type { RawSummary } from "./schema.js";

/**
 * The states a finished Bolt order ends in. Also the states a caller can filter
 * receipts by (mcp/register/copy.ts): an order still in progress has no receipt worth
 * asking for.
 */
export const FINAL_STATES = ["delivered", "failed", "rejected"] as const;

const FINAL: ReadonlySet<string> = new Set(FINAL_STATES);

/**
 * Whether a stored detail can be trusted forever (packages/receipts,
 * freshness.ts): a week in a final state. A refund
 * (`order_refund_state: partially_refunded`) lands days after delivery.
 */
export const isSettled = (summary: RawSummary, nowMs: number): boolean =>
  FINAL.has(summary.order_state) &&
  settledSince((summary.order_final_state_transition_timestamp ?? summary.order_created_timestamp) * 1000, nowMs);
