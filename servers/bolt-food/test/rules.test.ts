import { toCsv } from "@foreverworks/receipts/domain";
import { describe, expect, it } from "vitest";

import { isSettled } from "../src/domain/freshness.js";
import { itemRows, rankItems } from "../src/domain/items.js";
import { toReceipt } from "../src/domain/receipt.js";
import { daysLeft, readTokenFacts } from "../src/domain/token.js";
import { details, item, JUL_15_1320, summary, TIME_ZONE } from "./fixtures.js";

const DAY = 86_400_000;

describe("isSettled", () => {
  const finalMs = (JUL_15_1320 + 2400) * 1000;

  it("waits a week after the final state, because refunds land later", () => {
    expect(isSettled(summary(), finalMs + 6 * DAY)).toBe(false);
    expect(isSettled(summary(), finalMs + 7 * DAY)).toBe(true);
  });

  it("never settles an order that is still in progress", () => {
    expect(isSettled(summary({ order_state: "preparing" }), finalMs + 365 * DAY)).toBe(false);
  });
});

describe("items", () => {
  const receipt = (orderId: number, state: string, items = [item()]) =>
    toReceipt(summary({ order_id: orderId, order_state: state }), details({ order_state: state, user_baskets: [{ items }] }), TIME_ZONE);

  it("ranks delivered, kept lines only, and sums spend exactly", () => {
    const removed = item({ name: { value: "Dropped" }, adjustment: { is_strike_through_adjusted_item: true } });
    const rows = [
      ...itemRows(receipt(1, "delivered", [item(), removed])),
      ...itemRows(receipt(2, "delivered")),
      ...itemRows(receipt(3, "rejected")),
    ];
    const ranked = rankItems(rows, undefined, 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ item: "Chicken Sandwich Meal", times: 2, qty: 2, spent: "105.20" });
  });

  it("writes CSV that survives quotes and commas in a product name", () => {
    const csv = toCsv(itemRows(receipt(1, "delivered", [item({ name: { value: 'Pizza "Diavola", 32cm' } })])));
    expect(csv.split("\n")[1]).toContain('"Pizza ""Diavola"", 32cm"');
  });
});

describe("token facts", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("reads the user and expiry without verifying the signature", () => {
    expect(readTokenFacts(jwt({ exp: 1_800_000_000, data: { user_id: 42 } }))).toEqual({ userId: 42, expiresAt: 1_800_000_000 });
    expect(readTokenFacts("not-a-jwt")).toBeUndefined();
  });

  it("counts whole days left", () => {
    expect(daysLeft({ expiresAt: 10 * 86_400 }, 3.5 * DAY)).toBe(6);
    expect(daysLeft({}, 0)).toBeUndefined();
  });
});
