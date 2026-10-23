import { describe, expect, it } from "vitest";

import { amountIn, parseDisplayAmount } from "../src/domain/money.js";

describe("parseDisplayAmount", () => {
  it("reads Glovo's Romanian number format exactly, thousands separators included", () => {
    expect(parseDisplayAmount("312,47 RON")).toEqual({ minor: 31247, currency: "RON" });
    expect(parseDisplayAmount("1.234,56 RON")).toEqual({ minor: 123456, currency: "RON" });
    expect(parseDisplayAmount("12.345.678,90 RON")).toEqual({ minor: 1234567890, currency: "RON" });
    expect(parseDisplayAmount("0,05 RON")).toEqual({ minor: 5, currency: "RON" });
  });

  it("keeps the sign of a discount", () => {
    expect(parseDisplayAmount("-5,00 RON")).toEqual({ minor: -500, currency: "RON" });
    expect(parseDisplayAmount("-64,20 RON")?.minor).toBe(-6420);
    expect(parseDisplayAmount("−5,00 RON")?.minor).toBe(-500);
  });

  it("reads 'No cost' and a free product's 'GRATUIT' as a real zero", () => {
    expect(parseDisplayAmount("No cost")).toEqual({ minor: 0 });
    expect(parseDisplayAmount("Fără costuri")).toEqual({ minor: 0 });
    expect(parseDisplayAmount("GRATUIT")).toEqual({ minor: 0 });
    expect(parseDisplayAmount("Free")).toEqual({ minor: 0 });
  });

  it("refuses what is not an amount instead of calling it zero", () => {
    for (const text of ["Cancelled", "Anulat", "-20%", "12.5 RON", "1,234.56 RON", "312,4 RON", "", null, undefined]) {
      expect(parseDisplayAmount(text)).toBeUndefined();
    }
  });
});

describe("amountIn", () => {
  it("finds the amount a payment sentence states, in English or Romanian", () => {
    expect(amountIn("307,47 RON was charged on your card ending in 1234.")?.minor).toBe(30747);
    expect(amountIn("1.307,47 RON a fost debitat de pe cardul tău cu terminația 1234")?.minor).toBe(130747);
    expect(amountIn("5,00 RON a fost plătit cu credite Glovo")?.minor).toBe(500);
  });

  it("finds none in a sentence that states none, card digits notwithstanding", () => {
    expect(amountIn("Was charged on your card ending in 1234")).toBeUndefined();
    expect(amountIn("Paid with Apple Pay")).toBeUndefined();
  });
});
