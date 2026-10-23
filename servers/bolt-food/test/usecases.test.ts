/**
 * Use cases against a FAKE BoltPort and store. No network, no credentials.
 */
import { describe, expect, it, vi } from "vitest";

import type { BoltPort, Deps, OrderStore } from "../src/app/ports.js";
import { receiptsFor } from "../src/app/usecases/details.js";
import { checkHealth } from "../src/app/usecases/health.js";
import { getReceipt, listOrders } from "../src/app/usecases/orders.js";
import { exportItems, getReceipts, matchCardCharges, orderStats } from "../src/app/usecases/receipts.js";
import { apiError, asAppError, authError, fail } from "../src/domain/errors.js";
import type { RawDetails } from "../src/domain/schema.js";
import { details, price, JUL_15_1320, summary, TIME_ZONE } from "./fixtures.js";

const DAY_S = 86_400;
const LONG_AFTER = (JUL_15_1320 + 30 * DAY_S) * 1000;

const memoryStore = (seed: Record<number, RawDetails> = {}): OrderStore & { data: Map<number, RawDetails> } => {
  const data = new Map(Object.entries(seed).map(([k, v]) => [Number(k), v]));
  return {
    data,
    read: async (id) => data.get(id),
    write: async (id, d) => void data.set(id, d),
    count: async () => data.size,
  };
};

const deps = (bolt: Partial<BoltPort>, over: Partial<Deps> = {}): Deps => ({
  bolt: {
    history: async () => [],
    orderDetails: async () => details(),
    probe: async () => ({ accessExpiresAt: 0 }),
    ...bolt,
  },
  store: memoryStore(),
  files: { writeText: async (dir, name, text) => ({ path: `${dir}/${name}`, sha256: "0".repeat(64), size: text.length }) },
  paths: { credentials: { variable: "BOLT_FOOD_CREDS", path: "/c.json" }, stateDir: "/s", ordersDir: "/s/orders", exportsDir: "/s/exports" },
  tokenFacts: async () => ({}),
  timeZone: TIME_ZONE,
  now: () => LONG_AFTER,
  ...over,
});

describe("the detail store", () => {
  it("serves a settled order from the store without calling Bolt", async () => {
    const orderDetails = vi.fn(async () => details());
    const d = deps({ history: async () => [summary()], orderDetails }, { store: memoryStore({ 1001: details() }) });
    await getReceipt(d, 1001);
    expect(orderDetails).not.toHaveBeenCalled();
  });

  it("stores a settled order after fetching it once", async () => {
    const store = memoryStore();
    await getReceipt(deps({ history: async () => [summary()] }, { store }), 1001);
    expect(store.data.has(1001)).toBe(true);
  });

  it("refetches a recent order every time and never stores it: a refund may still land", async () => {
    const store = memoryStore({ 1001: details({ refund_amount: null }) });
    const orderDetails = vi.fn(async () => details({ refund_amount: price(10), order_refund_state: "partially_refunded" }));
    const recent = deps({ history: async () => [summary()], orderDetails }, { store, now: () => (JUL_15_1320 + DAY_S) * 1000 });
    const r = await getReceipt(recent, 1001);
    expect(r.refund?.amount).toBe("10.00");
    expect(store.data.get(1001)?.refund_amount).toBeNull();
  });
});

describe("receiptsFor", () => {
  it("reports one unreadable order and keeps the rest", async () => {
    const d = deps({
      orderDetails: async (id) => (id === 2 ? fail(apiError(200, "nope", 404)) : details({ order_id: id })),
    });
    const out = await receiptsFor(d, [summary({ order_id: 1 }), summary({ order_id: 2 }), summary({ order_id: 3 })]);
    expect(out.map((f) => f.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ ok: false, orderId: 2, reason: "nope" });
  });

  it("stops at a dead token instead of recording it once per order", async () => {
    const orderDetails = vi.fn(async () => fail(authError(401, "refused")));
    const d = deps({ orderDetails });
    await expect(receiptsFor(d, [summary({ order_id: 1 }), summary({ order_id: 2 })])).rejects.toSatisfy(
      (e: unknown) => asAppError(e)?.kind === "auth",
    );
    expect(orderDetails).toHaveBeenCalledTimes(1);
  });
});

describe("listOrders", () => {
  it("filters by local date, provider and state, and reports the total before the limit", async () => {
    const history = [
      summary({ order_id: 3, order_created_timestamp: JUL_15_1320 + 2 * DAY_S, provider_name: { value: "Pizza Place" } }),
      summary({ order_id: 2, order_created_timestamp: JUL_15_1320 + DAY_S, order_state: "rejected" }),
      summary({ order_id: 1 }),
    ];
    const out = await listOrders(deps({ history: async () => history }), { since: "2026-07-15", state: "delivered", limit: 1 });
    expect(out.total).toBe(2);
    expect(out.orders.map((o) => o.orderId)).toEqual([3]);
  });
});

describe("getReceipts", () => {
  it("returns headlines by default and fetches only orders in range", async () => {
    const orderDetails = vi.fn(async (id: number) => details({ order_id: id }));
    const history = [summary({ order_id: 2, order_created_timestamp: JUL_15_1320 + 40 * DAY_S }), summary({ order_id: 1 })];
    const out = await getReceipts(deps({ history: async () => history, orderDetails }), {
      since: "2026-07-01",
      until: "2026-07-31",
      detail: "headline",
    });
    expect(orderDetails).toHaveBeenCalledTimes(1);
    expect(out.receipts).toEqual([
      { orderId: 1, provider: "Test Kitchen", localDate: "2026-07-15", localTime: "13:20", total: "60.19", charged: { card: "57.84", boltBalance: "2.35" }, itemCount: 1 },
    ]);
  });
});

describe("orderStats", () => {
  it("adds what delivered orders took, every leg, per restaurant and per month", async () => {
    const history = [
      summary({ order_id: 3, order_created_timestamp: JUL_15_1320 + 30 * DAY_S, order_state: "rejected" }),
      summary({ order_id: 2, order_created_timestamp: JUL_15_1320 + DAY_S, provider_name: { value: "Pizza Place" } }),
      summary({ order_id: 1 }),
    ];
    const byId: Record<number, RawDetails> = {
      1: details({ order_id: 1 }),
      2: details({ order_id: 2, provider_name: { value: "Pizza Place" }, order_created_timestamp: JUL_15_1320 + DAY_S, payment_methods: [{ type: "card", amount: price(30) }] }),
    };
    const out = await orderStats(deps({ history: async () => history, orderDetails: vi.fn(async (id: number) => byId[id] as RawDetails) }), { top: 20 });
    expect(out).toMatchObject({
      delivered: 2,
      totals: [{ currency: "RON", orders: 2, paid: "90.19", card: "87.84", average: "45.10" }],
      byStore: [
        { store: "Test Kitchen", orders: 1, paid: "60.19", card: "57.84" },
        { store: "Pizza Place", orders: 1, paid: "30.00", card: "30.00" },
      ],
      byMonth: [{ month: "2026-07", currency: "RON", orders: 2, paid: "90.19" }],
    });
  });
});

describe("matchCardCharges", () => {
  const history = [
    summary({ order_id: 3, order_created_timestamp: JUL_15_1320 + 20 * DAY_S }),
    summary({ order_id: 2, order_created_timestamp: JUL_15_1320 + DAY_S }),
    summary({ order_id: 1 }),
  ];
  const byId: Record<number, RawDetails> = {
    1: details({ order_id: 1 }),
    2: details({ order_id: 2, payment_methods: [{ type: "card", amount: price(30) }] }),
    3: details({ order_id: 3, payment_methods: [{ type: "card", amount: price(99) }] }),
  };
  const d = () => deps({ history: async () => history, orderDetails: vi.fn(async (id: number) => byId[id] as RawDetails) });

  it("pairs bank rows by card leg, and lists what did not pair on either side", async () => {
    const bolt = d();
    const out = await matchCardCharges(bolt, {
      charges: [
        { id: "tx-a", date: "2026-07-15", amount: "-57.84", currency: "ron" },
        { id: "tx-b", date: "2026-07-16", amount: "-12.00", currency: "RON" },
        // A refund of order 2's card leg: money in, which must not claim the order.
        { id: "tx-r", date: "2026-07-16", amount: "30.00", currency: "RON" },
      ],
      detail: "headline",
    });
    expect(out.matched).toEqual([{ chargeId: "tx-a", dayOffset: 0, order: expect.objectContaining({ orderId: 1, charged: { card: "57.84", boltBalance: "2.35" } }) }]);
    expect(out.unmatchedCharges).toEqual(["tx-b"]);
    expect(out.credits).toEqual(["tx-r"]);
    expect(out.unmatchedOrders.map((o) => o.orderId)).toEqual([2]);
    // Order 3 is three weeks out of the window and was never fetched.
    expect(bolt.bolt.orderDetails).toHaveBeenCalledTimes(2);
    // The window names Bolt's date basis, in this key order, as it always has.
    expect(JSON.stringify(out.window)).toBe('{"orderDatesSearched":{"since":"2026-07-13","until":"2026-07-17"},"daysBefore":1,"daysAfter":2}');
  });
});

describe("exportItems", () => {
  it("writes the CSV to the exports dir and says how much it wrote", async () => {
    const writeText = vi.fn(async (dir: string, name: string, text: string) => ({ path: `${dir}/${name}`, sha256: "a".repeat(64), size: text.length }));
    const out = await exportItems(deps({ history: async () => [summary()] }, { files: { writeText } }), { since: "2026-07-01" });
    expect(out).toMatchObject({ path: expect.stringMatching(/^\/s\/exports\/bolt-food-items-2026-07-01-latest-\d{4}-\d\d-\d\dT[\d-]+Z\.csv$/), sha256: "a".repeat(64), orders: 1, lineItems: 1, unreadableOrders: 0 });
    expect(out.size).toBe(Buffer.byteLength(writeText.mock.calls[0]?.[2] ?? "", "utf8"));
    expect(writeText.mock.calls[0]?.[2]).toContain("Chicken Sandwich Meal");
  });
});

describe("checkHealth", () => {
  it("flags a refresh token inside the two-week warning", async () => {
    const d = deps(
      { history: async () => [summary()], probe: async () => ({ accessExpiresAt: 1 }) },
      { tokenFacts: async () => ({ userId: 9, expiresAt: LONG_AFTER / 1000 + 10 * DAY_S }) },
    );
    const h = await checkHealth(d);
    expect(h).toMatchObject({ ok: true, userId: 9, refreshTokenDaysLeft: 10, refreshTokenExpiringSoon: true, orders: 1 });
    expect(h.latestOrder).toEqual({ orderId: 1001, localDate: "2026-07-15", state: "delivered" });
  });
});
