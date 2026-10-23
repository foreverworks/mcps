import { containsIgnoringCase, currencyOf, type DateRange, formatMinor, inRange, localMoment } from "@foreverworks/receipts/domain";

import { toMinor } from "./money.js";
import type { RawSummary } from "./schema.js";

/**
 * An order-history row, which carries no products and no payment split.
 *
 * Its price is named `listedPrice` on purpose. It is the figure the app's order
 * list shows, and it is NOT what the card paid: it leaves out the courier tip
 * (so it differs from the detail total on every order with a tip) and knows
 * nothing about a Bolt Balance leg. Calling it `total` would invite a join on it.
 */
export const orderSummary = (raw: RawSummary, timeZone: string) => {
  const when = localMoment(raw.order_created_timestamp * 1000, timeZone);
  return {
    orderId: raw.order_id,
    localDate: when.date,
    localTime: when.time,
    provider: raw.provider_name?.value,
    state: raw.order_state,
    listedPrice: formatMinor(toMinor(raw.price?.value)),
    currency: currencyOf(raw.price?.currency),
  };
};

export type OrderSummary = ReturnType<typeof orderSummary>;

export type OrderFilter = DateRange & {
  readonly provider?: string;
  readonly state?: string;
};

export const matchesFilter = (summary: OrderSummary, filter: OrderFilter): boolean =>
  inRange(summary.localDate, filter) &&
  (filter.state === undefined || summary.state === filter.state) &&
  containsIgnoringCase(summary.provider, filter.provider);
