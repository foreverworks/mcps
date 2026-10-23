/**
 * Use cases against a FAKE GlovoPort and store. No network, no credentials.
 */
import { describe, expect, it, vi } from "vitest";

import type { Deps, GlovoPort, HistoryPage, OrderStore } from "../src/app/ports.js";
import { receiptsInRange } from "../src/app/usecases/details.js";
import { checkHealth } from "../src/app/usecases/health.js";
import { getReceipt, listOrders } from "../src/app/usecases/orders.js";
import { exportItems, getReceipts, matchCardCharges, orderStats, searchItems } from "../src/app/usecases/receipts.js";
import { apiError, asAppError, authError, fail } from "../src/domain/errors.js";
import type { RawDetails, RawListRow } from "../src/domain/schema.js";
import { cardOnly, DAY_MS, details, row, SEP_08_1539, TIME_ZONE } from "./fixtures.js";

const LONG_AFTER = SEP_08_1539 + 60 * DAY_MS;

const memoryStore = (seed: Record<number, RawDetails> = {}): OrderStore & { data: Map<number, RawDetails> } => {
  const data = new Map(Object.entries(seed).map(([k, v]) => [Number(k), v]));
  return {
    data,
    read: async (id) => data.get(id),
    write: async (id, d) => void data.set(id, d),
    count: async () => data.size,
  };
};

/** A history split into pages of `size`, newest first, with cursors like Glovo's (the last id of the page). */
const pagesOf = (rows: readonly RawListRow[], size = 2) =>
  vi.fn(async (cursor: string | undefined): Promise<HistoryPage> => {
    const start = cursor === undefined ? 0 : rows.findIndex((r) => String(r.orderId) === cursor) + 1;
    const orders = rows.slice(start, start + size);
    const last = orders.at(-1);
    return { orders, ...(start + size < rows.length && last ? { next: String(last.orderId) } : {}) };
  });

const deps = (glovo: Partial<GlovoPort>, over: Partial<Deps> = {}): Deps => ({
  glovo: {
    historyPage: async () => ({ orders: [] }),
    orderDetails: async (id) => details({ id }),
    probe: async () => ({ accessExpiresAt: 0 }),
    ...glovo,
  },
  store: memoryStore(),
  files: { writeText: async (dir, name, text) => ({ path: `${dir}/${name}`, sha256: "0".repeat(64), size: text.length }) },
  paths: { credentials: { variable: "GLOVO_CREDS", path: "/c.json" }, stateDir: "/s", ordersDir: "/s/orders", exportsDir: "/s/exports" },
  timeZone: TIME_ZONE,
  tokenFacts: async () => ({}),
  now: () => LONG_AFTER,
  ...over,
});

/** Ten orders, one a day, newest (id 10, 2026-09-17) first. */
const tenDays = () => {
  const byId: Record<number, RawDetails> = {};
  for (let id = 1; id <= 10; id += 1) byId[id] = cardOnly(id, `${id}0,00 RON`, SEP_08_1539 + (id - 1) * DAY_MS);
  const rows = Object.keys(byId)
    .map(Number)
    .sort((a, b) => b - a)
    .map((id) => row(id));
  return { byId, rows };
};

describe("the detail store", () => {
  it("serves a stored order without calling Glovo", async () => {
    const orderDetails = vi.fn(async () => details());
    await getReceipt(deps({ orderDetails }, { store: memoryStore({ 1001: details() }) }), 1001);
    expect(orderDetails).not.toHaveBeenCalled();
  });

  it("stores a settled order after fetching it once", async () => {
    const store = memoryStore();
    await getReceipt(deps({}, { store }), 1001);
    expect(store.data.has(1001)).toBe(true);
  });

  it("never stores a recent order: a refund may still land", async () => {
    const store = memoryStore();
    const r = await getReceipt(deps({}, { store, now: () => SEP_08_1539 + DAY_MS }), 1001);
    expect(r.state).toBe("delivered");
    expect(store.data.size).toBe(0);
  });
});

describe("receiptsInRange", () => {
  it("walks newest first and stops once an order is clearly older than the range", async () => {
    const { byId, rows } = tenDays();
    const orderDetails = vi.fn(async (id: number) => byId[id] as RawDetails);
    const historyPage = pagesOf(rows);
    const out = await receiptsInRange(deps({ historyPage, orderDetails }), { since: "2026-09-12", until: "2026-09-14" });
    expect(out.map((f) => (f.ok ? f.receipt.orderId : -1))).toEqual([7, 6, 5]);
    // 10..8 are newer than the range, 4 is the one-day slack, 3 is where it stops.
    expect(orderDetails.mock.calls.map((c) => c[0])).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
    expect(historyPage).toHaveBeenCalledTimes(4);
  });

  it("reports one unreadable order and keeps the rest", async () => {
    const d = deps({
      historyPage: pagesOf([row(3), row(2), row(1)]),
      orderDetails: async (id) => (id === 2 ? fail(apiError(500, "nope")) : details({ id })),
    });
    const out = await receiptsInRange(d, {});
    expect(out.map((f) => f.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ ok: false, orderId: 2, reason: "nope" });
  });

  it("stops at a dead token instead of recording it once per order", async () => {
    const orderDetails = vi.fn(async () => fail(authError(401, "refused")));
    const d = deps({ historyPage: pagesOf([row(2), row(1)]), orderDetails });
    await expect(receiptsInRange(d, {})).rejects.toSatisfy((e: unknown) => asAppError(e)?.kind === "auth");
    expect(orderDetails).toHaveBeenCalledTimes(1);
  });
});

describe("listOrders", () => {
  it("reads only as many pages as the limit needs, and dates the rows already stored", async () => {
    const historyPage = pagesOf([row(5), row(4, { content: { title: "Pizza Place" } }), row(3), row(2), row(1)]);
    const store = memoryStore({ 5: details({ id: 5 }) });
    const out = await listOrders(deps({ historyPage }, { store }), { limit: 2 });
    expect(out.complete).toBe(false);
    expect(historyPage).toHaveBeenCalledTimes(1);
    expect(out.orders[0]).toMatchObject({ orderId: 5, state: "delivered", localDate: "2026-09-08", localTime: "15:39" });
    expect("localDate" in (out.orders[1] ?? {})).toBe(false);
  });

  it("filters by store and status across pages", async () => {
    const historyPage = pagesOf([
      row(5),
      row(4, { content: { title: "Pizza Place" } }),
      row(3, { footer: { left: { data: "Cancelled" } } }),
      row(2, { content: { title: "pizza place" } }),
    ]);
    const out = await listOrders(deps({ historyPage }), { store: "PIZZA", limit: 10 });
    expect(out).toMatchObject({ scanned: 4, complete: true });
    expect(out.orders.map((o) => o.orderId)).toEqual([4, 2]);
    const canceled = await listOrders(deps({ historyPage }), { status: "canceled", limit: 10 });
    expect(canceled.orders.map((o) => o.orderId)).toEqual([3]);
  });
});

describe("orderStats", () => {
  it("adds what delivered orders took per store and per month, leaving a cancelled one out", async () => {
    const { byId, rows } = tenDays();
    byId[6] = cardOnly(6, "60,00 RON", SEP_08_1539 + 5 * DAY_MS, {
      currentStatus: { type: "CanceledStatus", creationTime: SEP_08_1539 + 5 * DAY_MS },
    });
    const d = deps({ historyPage: pagesOf(rows), orderDetails: async (id) => byId[id] as RawDetails });
    expect(await orderStats(d, { since: "2026-09-12", until: "2026-09-14", top: 20 })).toMatchObject({
      delivered: 2,
      totals: [{ currency: "RON", orders: 2, paid: "120.00", card: "120.00", average: "60.00", first: "2026-09-12", last: "2026-09-14" }],
      byStore: [{ store: "Test Kitchen", orders: 2, paid: "120.00" }],
      byMonth: [{ month: "2026-09", orders: 2, paid: "120.00" }],
    });
  });
});

describe("getReceipts", () => {
  it("returns headlines for the range, filtered by state", async () => {
    const { byId, rows } = tenDays();
    byId[6] = cardOnly(6, "60,00 RON", SEP_08_1539 + 5 * DAY_MS, {
      currentStatus: { type: "CanceledStatus", creationTime: SEP_08_1539 + 5 * DAY_MS },
    });
    const d = deps({ historyPage: pagesOf(rows), orderDetails: async (id) => byId[id] as RawDetails });
    const out = await getReceipts(d, { since: "2026-09-12", until: "2026-09-14", state: "delivered", detail: "headline" });
    expect(out.count).toBe(2);
    expect(out.receipts[0]).toEqual({
      orderId: 7,
      store: "Test Kitchen",
      vertical: "FOOD",
      state: "delivered",
      localDate: "2026-09-14",
      localTime: "15:39",
      total: "70.00",
      charged: { card: "70.00", glovoCredit: "0.00" },
      itemCount: 1,
    });
  });
});

describe("matchCardCharges", () => {
  const setup = () => {
    const { byId, rows } = tenDays();
    const orderDetails = vi.fn(async (id: number) => byId[id] as RawDetails);
    return { d: deps({ historyPage: pagesOf(rows), orderDetails }), orderDetails };
  };

  it("pairs bank rows by card leg and UTC delivery date, and lists what did not pair on either side", async () => {
    const { d, orderDetails } = setup();
    const out = await matchCardCharges(d, {
      charges: [
        { id: "tx-7", date: "2026-09-15", amount: "-70.00", currency: "ron" },
        { id: "tx-x", date: "2026-09-15", amount: "-12.00", currency: "RON" },
        { id: "tx-8", date: "2026-09-16", amount: "-80,00", currency: "RON" },
      ],
      detail: "headline",
    });
    expect(out.matched.map((m) => [m.chargeId, m.order.orderId, m.dayOffset])).toEqual([
      ["tx-7", 7, 1],
      ["tx-8", 8, 1],
    ]);
    expect(out.unmatchedCharges).toEqual(["tx-x"]);
    // Order 9 (2026-09-16) is inside the span and unclaimed; 6 and 10 are only in the window.
    expect(out.unmatchedOrders.map((o) => o.orderId)).toEqual([9]);
    expect(out.window.deliveryDatesSearched).toEqual({ since: "2026-09-13", until: "2026-09-17" });
    // The window names Glovo's date basis, in this key order, as it always has.
    expect(JSON.stringify(out.window)).toBe(
      '{"deliveryDatesSearched":{"since":"2026-09-13","until":"2026-09-17"},"dateBasis":"UTC date of delivery","daysBefore":1,"daysAfter":2}',
    );
    // The walk read one order past the window (3, 2026-09-10) and stopped there.
    expect(orderDetails.mock.calls.map((c) => c[0])).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
  });

  it("leaves cash and in-progress orders out: no card row exists for them yet", async () => {
    const rows = [row(2), row(1)];
    const byId: Record<number, RawDetails> = {
      2: cardOnly(2, "50,00 RON", SEP_08_1539, { paymentMethodsBreakdown: [{ type: "OTHER", text: "Paid with Cash" }] }),
      1: cardOnly(1, "50,00 RON", SEP_08_1539, { currentStatus: { type: "ProgressStatus", creationTime: SEP_08_1539 } }),
    };
    const d = deps({ historyPage: pagesOf(rows), orderDetails: async (id) => byId[id] as RawDetails });
    const out = await matchCardCharges(d, { charges: [{ id: "tx", date: "2026-09-08", amount: "-50.00", currency: "RON" }], detail: "headline" });
    expect(out.matched).toEqual([]);
    expect(out.unmatchedOrders).toEqual([]);
  });
});

describe("items", () => {
  it("ranks and exports what the range holds", async () => {
    const { byId, rows } = tenDays();
    const written = async (dir: string, name: string, text: string) => ({ path: `${dir}/${name}`, sha256: "a".repeat(64), size: Buffer.byteLength(text) });
    const d = (writeText = vi.fn(written)) =>
      deps({ historyPage: pagesOf(rows), orderDetails: async (id) => byId[id] as RawDetails }, { files: { writeText } });
    const found = await searchItems(d(), { since: "2026-09-16", query: "burger", top: 5 });
    expect(found.items).toEqual([
      expect.objectContaining({ item: "Test Burger Menu", times: 2, qty: 2, spent: "190.00", first: "2026-09-16", last: "2026-09-17" }),
    ]);
    const writeText = vi.fn(written);
    const out = await exportItems(d(writeText), { since: "2026-09-16" });
    expect(out).toMatchObject({ path: expect.stringMatching(/^\/s\/exports\/glovo-items-2026-09-16-latest-\d{4}-\d\d-\d\dT[\d-]+Z\.csv$/), sha256: "a".repeat(64), orders: 2, lineItems: 2, unreadableOrders: 0 });
    expect(out.size).toBe(Buffer.byteLength(writeText.mock.calls[0]?.[2] ?? ""));
    expect(writeText.mock.calls[0]?.[2]).toContain("Test Burger Menu");
  });
});

describe("checkHealth", () => {
  it("reports the user, the newest order and the store, from one page and one detail", async () => {
    const orderDetails = vi.fn(async (id: number) => details({ id }));
    const d = deps(
      { historyPage: async () => ({ orders: [row(1001), row(1000)], next: "1000" }), probe: async () => ({ accessExpiresAt: 1_800_000_000 }), orderDetails },
      { tokenFacts: async () => ({ userId: 9 }) },
    );
    const h = await checkHealth(d);
    expect(h).toMatchObject({ ok: true, userId: 9, firstPageOrders: 2, moreHistory: true, storedOrderDetails: 1 });
    expect(h.latestOrder).toEqual({ orderId: 1001, store: "Test Kitchen", state: "delivered", localDate: "2026-09-08", total: "1234.56" });
    expect(orderDetails).toHaveBeenCalledTimes(1);
  });
});
