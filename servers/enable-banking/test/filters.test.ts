import { describe, expect, it } from "vitest";

import { applyFilter, folded, parseFilter, verdictOf } from "../src/domain/filters.js";
import type { Transaction } from "../src/domain/transactions.js";

const tx = (over: Partial<Transaction>): Transaction => ({
  reference: "E1",
  direction: "debit",
  amount: "-10.00",
  currency: "RON",
  status: "BOOK",
  bookingDate: "2026-09-01",
  valueDate: undefined,
  counterpartyName: undefined,
  counterpartyIban: undefined,
  remittance: undefined,
  bankCode: undefined,
  merchantCategoryCode: undefined,
  ...over,
});

describe("folded", () => {
  it("ignores case and both spellings of Romanian diacritics", () => {
    expect(folded("ȘANTIER Ţară")).toBe("santier tara");
    expect(folded("Şantier")).toBe("santier");
  });
});

describe("parseFilter", () => {
  it("asks for nothing when every argument is empty, and keeps the bounds as written", () => {
    expect(parseFilter({})).toBeUndefined();
    expect(parseFilter({ text: " ", amount_min: "" })).toBeUndefined();
    expect(parseFilter({ amount_min: " 100.50 ", direction: "credit" })).toEqual({ amountMin: "100.50", direction: "credit" });
  });
});

describe("verdictOf", () => {
  it("compares sizes exactly, sign ignored, bounds inclusive", () => {
    const f = { amountMin: "10", amountMax: "10.00" };
    expect(verdictOf(f, tx({ amount: "-10.00" }))).toBe("match");
    expect(verdictOf(f, tx({ amount: "10.001" }))).toBe("no_match");
    expect(verdictOf({ amountMin: "9007199254740.01" }, tx({ amount: "9007199254740.02" }))).toBe("match");
  });

  it("cannot judge an amount it could not read exactly", () => {
    expect(verdictOf({ amountMax: "5" }, tx({ amount: "-300", amountWarning: "a float" }))).toBe("amount_unreadable");
    expect(verdictOf({ text: "x" }, tx({ amount: "-300", amountWarning: "a float", remittance: "x" }))).toBe("match");
    expect(applyFilter({ amountMax: "5" }, [tx({ amount: "1" }), tx({ amount: "1e3" })])).toEqual({ kept: [tx({ amount: "1" })], amountUnreadable: 1 });
  });
});
