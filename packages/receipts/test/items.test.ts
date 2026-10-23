import { describe, expect, it } from "vitest";

import { rankItemsBy, toCsv } from "../src/domain/index.js";

type Row = { state: string; adjustment: string; localDate: string; item: string | undefined; shop: string; qty: number; price: string };

const row = (over: Partial<Row> = {}): Row => ({
  state: "delivered",
  adjustment: "",
  localDate: "2026-03-10",
  item: "Soup",
  shop: "Kitchen",
  qty: 1,
  price: "10.00",
  ...over,
});

const rank = rankItemsBy({
  name: (r: Row) => ({ item: r.item, shop: r.shop }),
  qty: (r) => r.qty,
  spentMinor: (r) => Math.round(Number(r.price) * 100),
  latest: (r) => ({ lastPrice: r.price }),
});

describe("rankItemsBy", () => {
  it("counts delivered, kept lines only, grouped by the app's name fields", () => {
    const ranked = rank(
      [row(), row({ localDate: "2026-03-12", price: "12.00", qty: 2 }), row({ state: "rejected" }), row({ adjustment: "removed" }), row({ shop: "Other" })],
      undefined,
      10,
    );
    expect(ranked).toEqual([
      { item: "Soup", shop: "Kitchen", times: 2, qty: 3, first: "2026-03-10", last: "2026-03-12", lastPrice: "12.00", spent: "22.00" },
      { item: "Soup", shop: "Other", times: 1, qty: 1, first: "2026-03-10", last: "2026-03-10", lastPrice: "10.00", spent: "10.00" },
    ]);
    // Key order is the tools' output order.
    expect(Object.keys(ranked[0] ?? {})).toEqual(["item", "shop", "times", "qty", "first", "last", "lastPrice", "spent"]);
  });

  it("filters by a case-insensitive query and keeps the top N, most ordered then most spent first", () => {
    const rows = [row({ item: "Pizza", price: "30.00" }), row({ item: "Soup" }), row({ item: "Soup" }), row({ item: "Pasta", price: "50.00" })];
    expect(rank(rows, undefined, 2).map((r) => r.item)).toEqual(["Soup", "Pasta"]);
    expect(rank(rows, "PIZ", 5).map((r) => r.item)).toEqual(["Pizza"]);
  });

  it("takes the latest fields from the most recent order, whatever the row order", () => {
    const ranked = rank([row({ localDate: "2026-03-12", price: "12.00" }), row({ localDate: "2026-03-03", price: "9.00" })], undefined, 1);
    expect(ranked[0]).toMatchObject({ first: "2026-03-03", last: "2026-03-12", lastPrice: "12.00" });
  });
});

describe("toCsv", () => {
  it("writes a header from the first row and survives quotes and commas", () => {
    const csv = toCsv([{ a: 'Pizza "Diavola", 32cm', b: undefined }, { a: "x", b: 2 }]);
    expect(csv).toBe('a,b\n"Pizza ""Diavola"", 32cm",""\n"x","2"\n');
    expect(toCsv([])).toBe("");
  });
});
