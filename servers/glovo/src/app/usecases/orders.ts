import { containsIgnoringCase, localMoment } from "@foreverworks/receipts/domain";

import { stateOf } from "../../domain/receipt.js";
import { type ListStatus, type OrderSummary, orderSummary } from "../../domain/summary.js";
import type { Deps } from "../ports.js";
import { historyRows, receiptFor } from "./details.js";

export type ListInput = {
  readonly store?: string;
  readonly status?: ListStatus;
  readonly limit: number;
};

/**
 * The history, newest first, without a detail call per row.
 *
 * Pages are read only until `limit` rows match, so the default is a few calls.
 * A row whose details are already stored carries its state and local date,
 * because that costs a file read; the others do not, because it would cost a
 * detail call each. `complete` says whether the whole history was scanned.
 */
export const listOrders = async (deps: Deps, input: ListInput) => {
  const orders: (OrderSummary & { state?: string; localDate?: string; localTime?: string })[] = [];
  let scanned = 0;
  let complete = true;
  for await (const row of historyRows(deps)) {
    scanned += 1;
    const summary = orderSummary(row);
    if (!containsIgnoringCase(summary.store, input.store) || (input.status !== undefined && summary.status !== input.status)) continue;
    const stored = await deps.store.read(row.orderId);
    const at = stored?.currentStatus?.creationTime ?? undefined;
    if (stored && at !== undefined) {
      const when = localMoment(at, deps.timeZone);
      orders.push({ ...summary, state: stateOf(stored), localDate: when.date, localTime: when.time });
    } else {
      orders.push(summary);
    }
    if (orders.length >= input.limit) {
      complete = false;
      break;
    }
  }
  return { scanned, complete, orders };
};

export const getReceipt = (deps: Deps, orderId: number) => receiptFor(deps, orderId);
