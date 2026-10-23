import { describe, expect, it } from "vitest";

import { asAmount, computable, documentTotal, lineAmount, reversalTotal, type TaxedLine } from "../src/invoiceTotals.js";

const line = (price: string, quantity: string, vatPercentage: string, vatIncluded = false): TaxedLine => ({
  price,
  quantity,
  vatPercentage,
  vatIncluded,
});

const total = (...lines: TaxedLine[]) => documentTotal(lines, "RON");

describe("documentTotal, EN 16931 rounding", () => {
  it("adds VAT on top of a net price", () => {
    expect(total(line("1000.00", "1", "21"))).toMatchObject({ net: "1000.00", vat: "210.00", gross: "1210.00", currency: "RON" });
  });

  it("takes VAT out of a gross price, and keeps the gross", () => {
    expect(total(line("121.00", "1", "21", true))).toMatchObject({ net: "100.00", vat: "21.00", gross: "121.00" });
  });

  it("computes VAT once per rate on the sum, not per line", () => {
    // Three lines of 0.10 at 5%: per line it would be 3 x round(0.005) = 0.03;
    // per rate it is round(0.30 x 5%) = round(0.015) = 0.02, which is what ANAF checks.
    expect(total(line("0.10", "1", "5"), line("0.10", "1", "5"), line("0.10", "1", "5"))).toMatchObject({
      net: "0.30",
      vat: "0.02",
      gross: "0.32",
    });
  });

  it("rounds each line's amount before summing", () => {
    // 3 x 0.333 = 0.999 -> 1.00 on the line.
    expect(total(line("0.333", "3", "0")).net).toBe("1.00");
    expect(lineAmount(line("0.333", "3", "0"))).toBe("1.00");
  });

  it("keeps rates apart and treats 21 and 21.00 as one", () => {
    const t = total(line("100", "1", "21"), line("100", "2", "21.00"), line("50", "1", "9"));
    expect(t.byRate).toHaveLength(2);
    expect(t).toMatchObject({ net: "350.00", vat: "67.50", gross: "417.50" });
  });

  it("keeps VAT-inclusive and VAT-exclusive lines of one rate apart", () => {
    const t = total(line("100.00", "1", "21"), line("121.00", "1", "21", true));
    expect(t.byRate).toHaveLength(2);
    expect(t).toMatchObject({ net: "200.00", vat: "42.00", gross: "242.00" });
  });

  it("keeps two VAT categories of one rate apart, and names a category only where the lines do", () => {
    const t = total({ ...line("100", "1", "0"), vatCategory: "Z" }, { ...line("50", "1", "0"), vatCategory: "E" }, line("10", "1", "0"));
    expect(t.byRate.map((r) => [r.vatCategory, r.net])).toEqual([
      ["Z", "100.00"],
      ["E", "50.00"],
      [undefined, "10.00"],
    ]);
    expect("vatCategory" in t.byRate[2]!).toBe(false);
  });

  it("handles quantities with decimals", () => {
    expect(total(line("150.00", "2.5", "21"))).toMatchObject({ net: "375.00", vat: "78.75", gross: "453.75" });
  });

  it("says whether a set of lines can be totalled at all", () => {
    expect(computable([line("1", "1", "21")])).toBe(true);
    expect(computable([])).toBe(false);
    expect(computable([line("1e3", "1", "21")])).toBe(false);
  });
});

describe("reversalTotal, the total of a storno", () => {
  const negated = (l: TaxedLine): TaxedLine => ({ ...l, quantity: l.quantity.startsWith("-") ? l.quantity.slice(1) : `-${l.quantity}` });
  // The rounding cases above: per-rate VAT on a sum, a line rounded before summing, two rates, incl. and excl. at one rate.
  const cases: readonly (readonly TaxedLine[])[] = [
    [line("1000.00", "1", "21")],
    [line("121.00", "1", "21", true)],
    [line("0.10", "1", "5"), line("0.10", "1", "5"), line("0.10", "1", "5")],
    [line("0.333", "3", "0")],
    [line("100", "1", "21"), line("100", "2", "21.00"), line("50", "1", "9")],
    [line("100.00", "1", "21"), line("121.00", "1", "21", true)],
    [line("150.00", "2.5", "21")],
    [line("0.05", "1", "9", true), line("1.15", "3", "19")],
  ];

  it("is exactly documentTotal of the same lines with their quantities negated", () => {
    for (const lines of cases) {
      const original = total(...lines);
      const storno = total(...lines.map(negated));
      expect(reversalTotal(original.gross)).toBe(storno.gross);
      expect(storno.vat).toBe(reversalTotal(original.vat));
      expect(storno.net).toBe(reversalTotal(original.net));
    }
  });

  it("negates an amount as an invoice prints it, in two decimals, and never prints -0", () => {
    expect(reversalTotal("1210.0000")).toBe("-1210.00");
    expect(reversalTotal("0.00")).toBe("0.00");
    expect(asAmount("51.2700")).toBe("51.27");
  });
});
