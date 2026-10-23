import { parseRange } from "@foreverworks/receipts/domain";

import { matchesFilter, orderSummary } from "../../domain/summary.js";
import type { Deps } from "../ports.js";
import { findOrder, receiptFor } from "./details.js";

export type ListInput = {
  readonly since?: string;
  readonly until?: string;
  readonly provider?: string;
  readonly state?: string;
  readonly limit: number;
};

/** One history call, no details. Cheap enough to answer "what did I order" without a receipt per row. */
export const listOrders = async (deps: Deps, input: ListInput) => {
  const range = parseRange(input.since, input.until);
  const all = (await deps.bolt.history()).map((raw) => orderSummary(raw, deps.timeZone)).filter((s) => matchesFilter(s, { ...input, ...range }));
  return { total: all.length, orders: all.slice(0, input.limit) };
};

export const getReceipt = async (deps: Deps, orderId: number) => receiptFor(deps, await findOrder(deps, orderId));
