import { toCsv } from "@foreverworks/receipts/domain";
import { describe, expect, it } from "vitest";

import { isSettled } from "../src/domain/freshness.js";
import { itemRows, rankItems } from "../src/domain/items.js";
import { toReceipt } from "../src/domain/receipt.js";
import { orderSummary } from "../src/domain/summary.js";
import { readTokenFacts } from "../src/domain/token.js";
import { DAY_MS, details, product, row, SEP_08_1539, TIME_ZONE } from "./fixtures.js";

describe("isSettled", () => {
  it("waits a week after the final status, because refunds land later", () => {
    expect(isSettled(details(), SEP_08_1539 + 6 * DAY_MS)).toBe(false);
    expect(isSettled(details(), SEP_08_1539 + 7 * DAY_MS)).toBe(true);
    expect(isSettled(details({ currentStatus: { type: "CanceledStatus", creationTime: SEP_08_1539 } }), SEP_08_1539 + 8 * DAY_MS)).toBe(true);
  });

  it("never settles an order in progress, or one with no status time", () => {
    expect(isSettled(details({ currentStatus: { type: "ProgressStatus", creationTime: SEP_08_1539 } }), SEP_08_1539 + 365 * DAY_MS)).toBe(false);
    expect(isSettled(details({ currentStatus: { type: "DeliveredStatus", creationTime: null } }), SEP_08_1539 + 365 * DAY_MS)).toBe(false);
  });
});

describe("orderSummary", () => {
  it("reads the listed total, and the footer word when there is no amount", () => {
    expect(orderSummary(row(1))).toEqual({
      orderId: 1,
      store: "Test Kitchen",
      status: "finished",
      listedTotal: "1234.56",
      currency: "RON",
      products: "2 x Test Burger Menu",
    });
    const status = (data: string, layoutType = "INACTIVE_ORDER") => orderSummary(row(1, { footer: { left: { data } }, layoutType })).status;
    expect([status("Cancelled"), status("Anulat"), status("Refunded"), status("Rambursat"), status("?"), status("117,03 RON", "ACTIVE_ORDER")]).toEqual([
      "canceled",
      "canceled",
      "refunded",
      "refunded",
      "unknown",
      "active",
    ]);
  });
});

describe("items", () => {
  const receipt = (orderId: number, state: string, products = [product()]) =>
    toReceipt(orderId, details({ id: orderId, currentStatus: { type: state, creationTime: SEP_08_1539 }, boughtProducts: products }), TIME_ZONE);

  it("ranks delivered, kept lines only, and sums spend exactly", () => {
    const removed = product({ name: "Dropped", notice: "Not available — you weren’t charged", displayStyle: "STRIKETHROUGH" });
    const rows = [
      ...itemRows(receipt(1, "DeliveredStatus", [product(), removed])),
      ...itemRows(receipt(2, "DeliveredStatus", [product({ price: "1.000,20 RON" })])),
      ...itemRows(receipt(3, "CanceledStatus")),
    ];
    const ranked = rankItems(rows, undefined, 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ item: "Test Burger Menu", store: "Test Kitchen", times: 2, qty: 4, spent: "1064.00" });
  });

  it("does not let a negative display price pull the spend down", () => {
    const rows = itemRows(receipt(1, "DeliveredStatus", [product({ price: "-4,90 RON" }), product()]));
    expect(rankItems(rows, "burger", 5)[0]?.spent).toBe("63.80");
  });

  it("writes CSV that survives quotes and commas in a product name", () => {
    const csv = toCsv(itemRows(receipt(1, "DeliveredStatus", [product({ name: 'Pizza "Diavola", 32cm' })])));
    expect(csv.split("\n")[1]).toContain('"Pizza ""Diavola"", 32cm"');
  });
});

describe("token facts", () => {
  const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

  it("reads the user id out of the payload claim, which is itself a JSON string", () => {
    const payload = JSON.stringify({ userId: 42, deviceId: 7, grantType: "PASSWORD" });
    expect(readTokenFacts(jwt({ iat: 1, role: "REFRESH", payload }))).toEqual({ userId: 42 });
    expect(readTokenFacts(jwt({ payload: { userId: 43 } }))).toEqual({ userId: 43 });
    expect(readTokenFacts(jwt({ role: "REFRESH" }))).toEqual({});
    expect(readTokenFacts("not-a-jwt")).toBeUndefined();
  });
});
