/**
 * Synthetic Bolt payloads, shaped like the ones the web app receives but with
 * invented names, ids, dates and amounts. Real ones carry a home address and a
 * phone number, so none is ever copied into this tree.
 */
import type { RawDetails, RawItem, RawSummary } from "../src/domain/schema.js";

const price = (value: number, original?: number, discount?: number) => ({
  value,
  currency: "ron",
  ...(original === undefined ? {} : { original_price: { value: original } }),
  ...(discount === undefined ? {} : { discount_percent: discount }),
});

/** The zone the fixtures' local dates are in: a summer instant there is UTC+3. */
export const TIME_ZONE = "Europe/Bucharest";

/** 2026-07-15 13:20 in TIME_ZONE. */
export const JUL_15_1320 = Date.parse("2026-07-15T10:20:00Z") / 1000;

export const summary = (over: Partial<RawSummary> = {}): RawSummary => ({
  order_id: 1001,
  city_id: 1,
  order_created_timestamp: JUL_15_1320,
  order_final_state_transition_timestamp: JUL_15_1320 + 2400,
  order_state: "delivered",
  provider_id: 7,
  provider_name: { value: "Test Kitchen" },
  price: price(54.97),
  ...over,
});

export const item = (over: Partial<RawItem> = {}): RawItem => ({
  name: { value: "Chicken Sandwich Meal" },
  menu_item_id: 55,
  amount: 1,
  user_note: null,
  unit_item_price: price(48.7),
  total_item_price: price(52.6),
  options: [
    { name: { value: "Large Fries" }, amount: 1, total_item_price: price(0) },
    { name: { value: "Garlic Mayo" }, amount: 1, total_item_price: price(3.9) },
  ],
  adjustment: null,
  ...over,
});

/** An invented order whose float legs drift when summed (2.35 + 57.84 = 60.190000000000005). */
export const details = (over: Partial<RawDetails> & Record<string, unknown> = {}): RawDetails => ({
  order_id: 1001,
  order_reference_id: "AB12C",
  order_state: "delivered",
  order_refund_state: null,
  refund_amount: null,
  provider_name: { value: "Test Kitchen" },
  order_created_timestamp: JUL_15_1320,
  total_price: price(60.190000000000005),
  user_baskets: [{ items: [item()] }],
  total_price_components: [
    { type: "total", data: { name: { value: "Subtotal" }, amount: price(52.6) } },
    { type: "fee", data: { name: { value: "Service fee" }, amount: price(3.16) } },
    { type: "discount", data: { name: { value: "Bolt Plus service discount" }, amount: price(-0.79) } },
    { type: "fee", data: { name: { value: "Tips" }, amount: price(5.22) } },
  ],
  payment_methods: [
    { type: "bolt_credit", title: { value: "Bolt Balance" }, amount: price(2.35) },
    { type: "card", title: { value: "Online payment" }, amount: price(57.84) },
  ],
  info_boxes: [],
  ...over,
});

export { price };
