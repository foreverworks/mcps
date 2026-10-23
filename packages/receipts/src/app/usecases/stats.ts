import { DELIVERED, orderStats } from "../../domain/index.js";
import { parseRange } from "../../domain/range.js";
import type { ReceiptCore } from "../../domain/receipt.js";
import type { Fetched } from "../fetched.js";
import type { ReceiptFilter } from "../receiptApp.js";

export type StatsInput = { readonly since?: string; readonly until?: string; readonly top: number };

type Source<D, R> = {
  readonly receiptsInRange: (deps: D, filter: ReceiptFilter) => Promise<readonly Fetched<R>[]>;
  readonly storeOf: (receipt: R) => string | undefined;
};

/**
 * What the delivered orders in a range cost, per store and per month. Like
 * search_items it may span the whole history, and after the first run it is
 * answered from the store.
 */
export const orderStatistics = async <D, R extends ReceiptCore>(app: Source<D, R>, deps: D, input: StatsInput) => {
  const range = parseRange(input.since, input.until);
  const fetched = await app.receiptsInRange(deps, { ...range, state: DELIVERED });
  const receipts = fetched.flatMap((f) => (f.ok ? [f.receipt] : []));
  return {
    since: range.since ?? "start",
    until: range.until ?? "latest",
    unreadableOrders: fetched.length - receipts.length,
    ...orderStats(receipts, app.storeOf, input.top),
  };
};
