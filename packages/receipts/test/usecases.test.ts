/**
 * The shared use cases against a FAKE app: its receipts are plain objects and
 * its source is an array. No network, no credentials, no files.
 */
import { makeErrorKit, makeHandled } from "@foreverworks/mcp-kit";
import { describe, expect, it, vi } from "vitest";

import { type Fetched, fetchOne, makeReceiptUseCases, type ReceiptFilter, type Written } from "../src/app/index.js";
import { commonRemedy, type CommonError, inRange, joinErrors } from "../src/domain/index.js";

type Receipt = {
  readonly orderId: number;
  readonly state: string;
  readonly localDate: string;
  readonly currency: string;
  readonly store?: string;
  readonly charged: { readonly card: string; readonly balance?: string };
  readonly items: readonly { readonly name: string; readonly adjustment?: string }[];
};

const receipt = (orderId: number, localDate: string, card: string, state = "delivered", extra: Partial<Receipt> = {}): Receipt => ({
  orderId,
  state,
  localDate,
  currency: "RON",
  charged: { card },
  items: [{ name: "Soup" }],
  ...extra,
});

type Deps = {
  readonly source: readonly Fetched<Receipt>[];
  readonly files: { readonly writeText: (dir: string, name: string, text: string) => Promise<Written> };
  readonly paths: { readonly exportsDir: string };
  readonly now: () => number;
};

const seen: ReceiptFilter[] = [];

const useCases = makeReceiptUseCases({
  name: "fake",
  receiptsInRange: async (deps: Deps, filter: ReceiptFilter) => {
    seen.push(filter);
    return deps.source.filter((f) => !f.ok || (inRange(f.receipt.localDate, filter) && (filter.state === undefined || f.receipt.state === filter.state)));
  },
  headline: (r: Receipt) => ({ orderId: r.orderId, card: r.charged.card }),
  itemRows: (r: Receipt) => r.items.map((i) => ({ orderId: r.orderId, state: r.state, localDate: r.localDate, item: i.name, adjustment: i.adjustment ?? "" })),
  rankItems: (rows) => rows.length,
  storeOf: (r: Receipt) => r.store,
  matching: {
    filter: (since, until) => ({ since, until, state: "delivered" }),
    dated: (r: Receipt) => ({ at: Date.parse(`${r.localDate}T12:00:00Z`), date: r.localDate }),
    searched: (since, until) => ({ datesSearched: { since, until } }),
  },
});

const written = async (dir: string, name: string, text: string): Promise<Written> => ({ path: `${dir}/${name}`, sha256: "0".repeat(64), size: text.length });

const NOW = Date.parse("2026-10-07T08:30:15.250Z");

const deps = (source: readonly Fetched<Receipt>[], writeText = vi.fn(written)): Deps => ({
  source,
  files: { writeText },
  paths: { exportsDir: "/out" },
  now: () => NOW,
});

const ok = (r: Receipt): Fetched<Receipt> => ({ ok: true, receipt: r });

const { asAppError } = joinErrors(makeErrorKit<never>("test"));
const handled = makeHandled({ asAppError, remedyFor: (e: CommonError) => commonRemedy(e) });
const errorOf = async (fn: () => Promise<unknown>) => JSON.parse((await handled(fn)()).content[0].text).error;

describe("getReceipts", () => {
  it("returns headlines by default, whole receipts on request, and an unreadable order as partial", async () => {
    const d = deps([ok(receipt(1, "2026-03-10", "42.50")), { ok: false, orderId: 2, reason: "nope" }]);
    const headlines = await useCases.getReceipts(d, { since: "2026-03-01", until: "2026-03-31", detail: "headline" });
    expect(headlines).toEqual({ count: 2, receipts: [{ orderId: 1, card: "42.50" }, { orderId: 2, partial: true, reason: "nope" }] });
    const full = await useCases.getReceipts(d, { since: "2026-03-01", until: "2026-03-31", state: "delivered", detail: "full" });
    expect(full.receipts[0]).toEqual(receipt(1, "2026-03-10", "42.50"));
    expect(seen.at(-1)).toEqual({ since: "2026-03-01", until: "2026-03-31", state: "delivered" });
  });

  it("refuses a range over the cap before reading anything", async () => {
    expect(await errorOf(() => useCases.getReceipts(deps([]), { since: "2026-01-01", until: "2026-12-31", detail: "headline" }))).toMatchObject({
      kind: "input",
    });
  });
});

describe("items", () => {
  it("ranks and exports what the range holds, naming the file after the server", async () => {
    const d = deps([ok(receipt(1, "2026-09-04", "1.00")), ok(receipt(2, "2026-09-20", "1.00")), { ok: false, orderId: 3, reason: "x" }]);
    expect(await useCases.searchItems(d, { since: "2026-09-10", top: 5 })).toEqual({ ordersScanned: 2, unreadableOrders: 1, items: 1 });
    const writeText = vi.fn(written);
    const out = await useCases.exportItems(deps(d.source, writeText), { since: "2026-09-10" });
    expect(out).toEqual({
      path: "/out/fake-items-2026-09-10-latest-2026-10-07T08-30-15-250Z.csv",
      sha256: "0".repeat(64),
      size: 79,
      orders: 2,
      lineItems: 1,
      unreadableOrders: 1,
    });
    expect(writeText.mock.calls[0]?.[2]).toBe('orderId,state,localDate,item,adjustment\n"2","delivered","2026-09-20","Soup",""\n');
  });
});

describe("orderStats", () => {
  it("adds what delivered orders cost per store and per month, exactly, and averages once, half up", async () => {
    const d = deps([
      ok(receipt(1, "2026-08-30", "40.00", "delivered", { store: "Ciorbărie", charged: { card: "40.00", balance: "5.50" } })),
      ok(receipt(2, "2026-09-02", "0.10", "delivered", { store: "Ciorbărie" })),
      ok(receipt(3, "2026-09-03", "0.20", "delivered", { store: "Ciorbărie" })),
      ok(receipt(4, "2026-09-05", "99.99", "delivered", { store: "Pizzeria" })),
      ok(receipt(5, "2026-09-06", "12.00", "canceled", { store: "Pizzeria" })),
      ok(receipt(6, "2026-09-07", "8.00", "delivered")),
      ok(receipt(7, "2026-09-10", "10.00", "delivered", { store: "Bistro", currency: "EUR" })),
      ok(receipt(8, "2026-09-11", "abc", "delivered", { store: "Bistro" })),
      { ok: false, orderId: 9, reason: "nope" },
    ]);
    const stats = await useCases.orderStats(d, { top: 2 });
    expect(seen.at(-1)).toEqual({ state: "delivered" });
    expect(stats).toEqual({
      since: "start",
      until: "latest",
      unreadableOrders: 1,
      delivered: 7,
      totals: [
        { currency: "RON", orders: 5, paid: "153.79", card: "148.29", average: "30.76", first: "2026-08-30", last: "2026-09-07" },
        { currency: "EUR", orders: 1, paid: "10.00", card: "10.00", average: "10.00", first: "2026-09-10", last: "2026-09-10" },
      ],
      stores: 4,
      byStore: [
        { store: "Pizzeria", currency: "RON", orders: 1, paid: "99.99", card: "99.99", average: "99.99", first: "2026-09-05", last: "2026-09-05" },
        // 45.80 over three orders is 15.2666...: rounded once, to 15.27.
        { store: "Ciorbărie", currency: "RON", orders: 3, paid: "45.80", card: "40.30", average: "15.27", first: "2026-08-30", last: "2026-09-03" },
      ],
      byMonth: [
        { month: "2026-08", currency: "RON", orders: 1, paid: "45.50", card: "40.00", average: "45.50" },
        { month: "2026-09", currency: "EUR", orders: 1, paid: "10.00", card: "10.00", average: "10.00" },
        { month: "2026-09", currency: "RON", orders: 4, paid: "108.29", card: "108.29", average: "27.07" },
      ],
      unpriced: 1,
    });
    const september = await useCases.orderStats(d, { since: "2026-09-01", until: "2026-09-30", top: 20 });
    expect(september).toMatchObject({ since: "2026-09-01", until: "2026-09-30", delivered: 6, stores: 4 });
    expect(september.byStore.map((s: { store: string | null; paid: string }) => [s.store, s.paid])).toEqual([
      ["Pizzeria", "99.99"],
      [null, "8.00"],
      ["Ciorbărie", "0.30"],
      ["Bistro", "10.00"],
    ]);
  });

  it("refuses a range that ends before it starts", async () => {
    expect(await errorOf(() => useCases.orderStats(deps([]), { since: "2026-09-30", until: "2026-09-01", top: 20 }))).toMatchObject({ kind: "input" });
  });
});

describe("matchCardCharges", () => {
  const source = [
    ok(receipt(1, "2026-03-10", "42.50")),
    ok(receipt(2, "2026-03-11", "30.00")),
    ok(receipt(3, "2026-03-13", "30.00")),
    ok(receipt(4, "2026-03-11", "0.00")),
    { ok: false, orderId: 5, reason: "gone" } as const,
  ];

  it("pairs rows by card leg, and lists what did not pair on either side", async () => {
    const out = await useCases.matchCardCharges(deps(source), {
      charges: [
        { id: "tx-a", date: "2026-03-10", amount: "-42.50", currency: "ron" },
        { id: "tx-b", date: "2026-03-11", amount: "-12,00", currency: "RON" },
        // A refund of order 2's amount: money in, so it must not claim the order.
        { id: "tx-r", date: "2026-03-11", amount: "30.00", currency: "RON" },
      ],
      detail: "headline",
    });
    expect(out.matched).toEqual([{ chargeId: "tx-a", dayOffset: 0, order: { orderId: 1, card: "42.50" } }]);
    expect(out.unmatchedCharges).toEqual(["tx-b"]);
    expect(out.credits).toEqual(["tx-r"]);
    // 2 is inside the charges' span and unclaimed; 3 is only in the window; 4 paid nothing by card.
    expect(out.unmatchedOrders).toEqual([{ orderId: 2, card: "30.00" }]);
    expect(out.unreadableOrders).toEqual([{ orderId: 5, reason: "gone" }]);
    expect(seen.at(-1)).toEqual({ since: "2026-03-08", until: "2026-03-12", state: "delivered" });
    expect(JSON.stringify(out.window)).toBe('{"datesSearched":{"since":"2026-03-08","until":"2026-03-12"},"daysBefore":1,"daysAfter":2}');
  });

  it("refuses rows that are all credits, a zero amount, and a currency that is not a code", async () => {
    const row = (amount: string, currency = "RON") => ({ id: "x", date: "2026-03-10", amount, currency });
    for (const charges of [[row("42.50")], [row("0.00")], [row("-42.50", "")], [row("-42.50", "lei ron")]]) {
      expect(await errorOf(() => useCases.matchCardCharges(deps(source), { charges, detail: "headline" }))).toMatchObject({ kind: "input" });
    }
    const allCredits = await errorOf(() => useCases.matchCardCharges(deps(source), { charges: [row("42.50")], detail: "headline" }));
    expect(allCredits.message).toContain("every amount is positive");
  });

  it("refuses an amount it cannot read rather than matching it as zero", async () => {
    const charges = [{ id: "x", date: "2026-03-10", amount: "-42.50 RON", currency: "RON" }];
    expect(await errorOf(() => useCases.matchCardCharges(deps(source), { charges, detail: "headline" }))).toMatchObject({ kind: "input" });
  });

  it("refuses no charges, a repeated id, a bad date, and a span over the cap", async () => {
    const row = (id: string, date: string) => ({ id, date, amount: "-1.00", currency: "RON" });
    for (const charges of [[], [row("a", "2026-03-10"), row("a", "2026-03-11")], [row("a", "2026-3-10")], [row("a", "2026-01-01"), row("b", "2026-12-31")]]) {
      expect(await errorOf(() => useCases.matchCardCharges(deps(source), { charges, detail: "headline" }))).toMatchObject({ kind: "input" });
    }
  });
});

describe("fetchOne", () => {
  type E = { readonly kind: "api" | "auth"; readonly message: string };
  const kit = makeErrorKit<E>("fetchOne");
  const failures = { asAppError: kit.asAppError, isSystemic: (e: E) => e.kind === "auth" };

  it("reports an order's own failure in place, and rethrows one that would fail them all", async () => {
    expect(await fetchOne(1, async () => kit.fail({ kind: "api", message: "nope" }), failures)).toEqual({ ok: false, orderId: 1, reason: "nope" });
    await expect(fetchOne(1, async () => kit.fail({ kind: "auth", message: "dead" }), failures)).rejects.toBeDefined();
    await expect(fetchOne(1, async () => Promise.reject(new Error("bug")), failures)).rejects.toThrow("bug");
  });
});
