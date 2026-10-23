import { MAX_RECEIPT_DAYS, parseRange } from "../../domain/range.js";
import type { Fetched } from "../fetched.js";
import type { Detail, ReceiptFilter } from "../receiptApp.js";
import { atDetail } from "./detail.js";

export type ReceiptsInput = {
  readonly since: string;
  readonly until: string;
  readonly state?: string;
  readonly detail: Detail;
};

type Source<D, R, H> = {
  readonly receiptsInRange: (deps: D, filter: ReceiptFilter) => Promise<readonly Fetched<R>[]>;
  readonly headline: (receipt: R) => H;
};

/**
 * Receipts for every order in a range of at most MAX_RECEIPT_DAYS. An order
 * the app will not return is a `{ partial: true }` row, not a failed batch.
 */
export const getReceipts = async <D, R, H>(app: Source<D, R, H>, deps: D, input: ReceiptsInput) => {
  const range = parseRange(input.since, input.until, MAX_RECEIPT_DAYS);
  const fetched = await app.receiptsInRange(deps, { ...range, ...(input.state ? { state: input.state } : {}) });
  const view = atDetail(app.headline, input.detail);
  return {
    count: fetched.length,
    receipts: fetched.map((f) => (f.ok ? view(f.receipt) : { orderId: f.orderId, partial: true, reason: f.reason })),
  };
};
