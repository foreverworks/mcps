import { describe, expect, it } from "vitest";

import { type Charge, matchCharges, payableOrder, type PayableOrder } from "../src/domain/index.js";

const order = (orderId: number, date: string, cardMinor: number, hour = 12): PayableOrder => ({
  orderId,
  at: Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`),
  date,
  cardMinor,
  currency: "RON",
});

const charge = (id: string, date: string, amountMinor: number, currency = "RON"): Charge => ({ id, date, amountMinor, currency });

describe("matchCharges", () => {
  it("joins on the card leg, which credits or a balance make smaller than the total", () => {
    // Order total 45.00, of which 2.50 came from an in-app balance.
    const out = matchCharges([order(1, "2026-03-10", 4250)], [charge("tx", "2026-03-10", 4250)]);
    expect(out.pairs).toEqual([{ chargeId: "tx", orderId: 1, dayOffset: 0 }]);
  });

  it("resolves two same-amount orders on one day to two rows, not one", () => {
    const out = matchCharges(
      [order(2, "2026-03-10", 3000, 19), order(1, "2026-03-10", 3000, 12)],
      [charge("b", "2026-03-10", 3000), charge("a", "2026-03-10", 3000)],
    );
    expect(out.pairs.map((p) => p.orderId).sort()).toEqual([1, 2]);
    expect(out.unmatchedCharges).toEqual([]);
    expect(out.unmatchedOrders).toEqual([]);
  });

  it("gives the earlier order the earlier booking", () => {
    const out = matchCharges(
      [order(1, "2026-03-10", 3000), order(2, "2026-03-11", 3000)],
      [charge("late", "2026-03-12", 3000), charge("early", "2026-03-10", 3000)],
    );
    expect(out.pairs).toEqual([
      { chargeId: "early", orderId: 1, dayOffset: 0 },
      { chargeId: "late", orderId: 2, dayOffset: 1 },
    ]);
  });

  it("accepts a booking one day before to two days after, and nothing wider", () => {
    const at = (date: string) => matchCharges([order(1, "2026-03-10", 100)], [charge("x", date, 100)]).pairs.length;
    expect([at("2026-03-08"), at("2026-03-09"), at("2026-03-12"), at("2026-03-13")]).toEqual([0, 1, 1, 0]);
  });

  it("does not pair across currencies or amounts", () => {
    const out = matchCharges([order(1, "2026-03-10", 100)], [charge("eur", "2026-03-10", 100, "EUR"), charge("off", "2026-03-10", 101)]);
    expect(out.pairs).toEqual([]);
    expect(out.unmatchedCharges).toEqual(["eur", "off"]);
    expect(out.unmatchedOrders).toEqual([1]);
  });

  it("ignores an order paid entirely from a balance, credits or cash: no card row exists to find", () => {
    expect(matchCharges([order(1, "2026-03-10", 0)], []).unmatchedOrders).toEqual([]);
  });
});

describe("payableOrder", () => {
  /** `currency: null` is a receipt with no currency at all. */
  const receipt = (card: string | undefined, currency: string | null = "RON") => ({
    orderId: 7,
    state: "delivered",
    ...(currency === null ? {} : { currency }),
    charged: { card },
    items: [],
  });
  const dated = { at: 1, date: "2026-03-10" };

  it("is the card leg in minor units, dated as the app dates it", () => {
    expect(payableOrder(receipt("42.50"), dated)).toEqual({ orderId: 7, at: 1, date: "2026-03-10", cardMinor: 4250, currency: "RON" });
  });

  it("is nothing when no card row can exist: no card leg, an unknown one, no currency, no date", () => {
    expect(payableOrder(receipt("0.00"), dated)).toBeUndefined();
    expect(payableOrder(receipt(undefined), dated)).toBeUndefined();
    expect(payableOrder(receipt("42.50", null), dated)).toBeUndefined();
    expect(payableOrder(receipt("42.50"), undefined)).toBeUndefined();
  });
});
