import { describe, expect, it } from "vitest";

import { headline, legsOf, toReceipt as receiptIn } from "../src/domain/receipt.js";
import { orderSummary as summaryIn } from "../src/domain/summary.js";
import type { RawDetails, RawSummary } from "../src/domain/schema.js";
import { details, item, price, summary, TIME_ZONE } from "./fixtures.js";

const toReceipt = (s: RawSummary, d: RawDetails) => receiptIn(s, d, TIME_ZONE);
const orderSummary = (s: RawSummary) => summaryIn(s, TIME_ZONE);

describe("legsOf", () => {
  it("splits the card leg from Bolt Balance, in exact minor units", () => {
    expect(legsOf(details())).toEqual({ card: 5784, boltBalance: 235, other: 0 });
  });

  it("keeps an unknown payment type out of the card leg", () => {
    const d = details({ payment_methods: [{ type: "cash", amount: price(10) }] });
    expect(legsOf(d)).toEqual({ card: 0, boltBalance: 0, other: 1000 });
  });
});

describe("toReceipt", () => {
  it("reports the card leg as charged, and the stated total unchanged", () => {
    const r = toReceipt(summary(), details());
    expect(r.total).toBe("60.19");
    expect(r.charged).toEqual({ card: "57.84", boltBalance: "2.35" });
    expect(r.payments).toEqual([
      { method: "bolt_balance", label: "Bolt Balance", amount: "2.35" },
      { method: "card", label: "Online payment", amount: "57.84" },
    ]);
  });

  it("places the order on its local date and time, in the configured zone", () => {
    const r = toReceipt(summary(), details());
    expect([r.localDate, r.localTime, r.currency]).toEqual(["2026-07-15", "13:20", "RON"]);
  });

  it("itemises products with options, and only mentions a discount when there was one", () => {
    const discounted = item({
      name: { value: "Soup" },
      unit_item_price: price(26.4, 33, 20),
      total_item_price: price(26.4, 33, 20),
      options: [],
      user_note: "no onion",
    });
    const r = toReceipt(summary(), details({ user_baskets: [{ items: [item(), discounted] }] }));
    expect(r.items[0]).toEqual({
      name: "Chicken Sandwich Meal",
      qty: 1,
      unitPrice: "48.70",
      lineTotal: "52.60",
      options: [
        { name: "Large Fries", qty: 1, price: "0.00" },
        { name: "Garlic Mayo", qty: 1, price: "3.90" },
      ],
    });
    expect(r.items[1]).toMatchObject({ lineTotalBeforeDiscount: "33.00", discountPercent: 20, note: "no onion" });
  });

  it("marks the lines a grocery picker removed and the ones that replaced them", () => {
    const removed = item({ name: { value: "Fresh juice" }, adjustment: { is_strike_through_adjusted_item: true, original: null } });
    const replacement = item({
      name: { value: "Bottled juice" },
      adjustment: { is_strike_through_adjusted_item: false, original: { text: { text: { value: "Replacement" } } } },
    });
    const r = toReceipt(summary(), details({ user_baskets: [{ items: [removed, replacement, item()] }] }));
    expect(r.items.map((i) => i.adjustment)).toEqual(["removed", "replacement", undefined]);
    expect(headline(r).itemCount).toBe(2);
  });

  it("passes Bolt's price lines through verbatim instead of pretending they add up", () => {
    const r = toReceipt(summary(), details());
    expect(r.priceLines.map((l) => l.label)).toEqual(["Subtotal", "Service fee", "Bolt Plus service discount", "Tips"]);
    expect(r.priceLines[2]).toEqual({ kind: "discount", label: "Bolt Plus service discount", amount: "-0.79" });
  });

  it("carries a refund and Bolt's notices when there are some", () => {
    const r = toReceipt(
      summary(),
      details({
        refund_amount: price(8.4),
        order_refund_state: "partially_refunded",
        info_boxes: [{ text: { value: "Item prices and quantity were updated." } }],
      }),
    );
    expect(r.refund).toEqual({ amount: "8.40", state: "partially_refunded" });
    expect(r.notices).toEqual(["Item prices and quantity were updated."]);
    expect("refund" in toReceipt(summary(), details())).toBe(false);
  });

  it("never lets the delivery address, note or courier out", () => {
    const leaky = details({
      delivery_address: "Strada Exemplu 1",
      delivery_note: "call 0700000000",
      courier: { name: "Courier C." },
    });
    const text = JSON.stringify(toReceipt(summary(), leaky));
    expect(text).not.toContain("Exemplu");
    expect(text).not.toContain("0700000000");
    expect(text).not.toContain("Courier C.");
  });

  it("degrades a payload with nothing in it rather than throwing", () => {
    const r = toReceipt(summary(), {});
    expect(r).toMatchObject({ provider: "Test Kitchen", state: "delivered", items: [] });
  });

  it("reports a missing total as missing, not as a free order", () => {
    // This test used to assert total: "0.00" on a payload carrying no
    // total_price, which is a figure Bolt never sent.
    expect(toReceipt(summary(), {}).total).toBeUndefined();
    expect(toReceipt(summary(), { total_price: { value: 0 } }).total).toBe("0.00");
  });
});

describe("orderSummary", () => {
  it("names the list price for what it is", () => {
    expect(orderSummary(summary())).toEqual({
      orderId: 1001,
      localDate: "2026-07-15",
      localTime: "13:20",
      provider: "Test Kitchen",
      state: "delivered",
      listedPrice: "54.97",
      currency: "RON",
    });
  });
});
