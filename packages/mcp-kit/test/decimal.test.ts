import { describe, expect, it } from "vitest";

import {
  add,
  compare,
  divideRounded,
  exactNumberText,
  formatDecimal,
  mul,
  parseDecimal,
  percentOf,
  percentWithin,
  placesOf,
  round,
  sub,
  sum,
  toDecimal,
} from "../src/decimal.js";

const t = (d: ReturnType<typeof toDecimal>) => formatDecimal(d);

describe("parsing and printing", () => {
  it("keeps the digits and the trailing zeros it was given", () => {
    expect(t(toDecimal("119.00"))).toBe("119.00");
    expect(t(toDecimal("-0.5"))).toBe("-0.5");
    expect(placesOf("119.00")).toBe(2);
    expect(placesOf("7")).toBe(0);
  });

  it("refuses anything but a plain decimal", () => {
    for (const bad of ["1e3", "1,5", "", ".5", "1.", " 1", "0x10", "NaN", "Infinity", "1.123456789"])
      expect(parseDecimal(bad)).toBeUndefined();
    expect(() => toDecimal("1e3")).toThrow(TypeError);
  });

  it("never prints -0", () => {
    expect(t(round(toDecimal("-0.001"), 2, "half-up"))).toBe("0.00");
  });
});

describe("arithmetic", () => {
  it("adds without the float error", () => {
    expect(t(add(toDecimal("0.1"), toDecimal("0.2")))).toBe("0.3");
  });

  it("keeps a 17-digit amount byte for byte", () => {
    // As a double, 999999999999999.99 is 1000000000000000.
    expect(t(add(toDecimal("999999999999999.98"), toDecimal("0.01")))).toBe("999999999999999.99");
  });

  it("subtracts, multiplies and sums exactly", () => {
    expect(t(sub(toDecimal("10.00"), toDecimal("0.01")))).toBe("9.99");
    expect(t(mul(toDecimal("1.1"), toDecimal("1.1")))).toBe("1.21");
    expect(t(sum([toDecimal("0.1"), toDecimal("0.2"), toDecimal("0.3")]))).toBe("0.6");
    expect(t(sum([]))).toBe("0");
  });

  it("compares across scales", () => {
    expect(compare(toDecimal("21"), toDecimal("21.00"))).toBe(0);
    expect(compare(toDecimal("-1"), toDecimal("0"))).toBe(-1);
  });
});

describe("rounding, always by a named rule", () => {
  it("half-up sends halves away from zero", () => {
    expect(t(round(toDecimal("2.345"), 2, "half-up"))).toBe("2.35");
    expect(t(round(toDecimal("-2.345"), 2, "half-up"))).toBe("-2.35");
    expect(t(round(toDecimal("2.344"), 2, "half-up"))).toBe("2.34");
  });

  it("half-even sends halves to the even neighbour", () => {
    expect(t(round(toDecimal("2.345"), 2, "half-even"))).toBe("2.34");
    expect(t(round(toDecimal("2.355"), 2, "half-even"))).toBe("2.36");
    expect(t(round(toDecimal("2.3451"), 2, "half-even"))).toBe("2.35");
  });

  it("widens without rounding", () => {
    expect(t(round(toDecimal("2.5"), 3, "half-up"))).toBe("2.500");
  });

  it("divides once, and refuses a zero divisor", () => {
    expect(divideRounded(5n, 2n, "half-up")).toBe(3n);
    expect(divideRounded(-5n, 2n, "half-up")).toBe(-3n);
    expect(divideRounded(5n, 2n, "half-even")).toBe(2n);
    expect(() => divideRounded(1n, 0n, "half-up")).toThrow(RangeError);
  });
});

describe("percentages", () => {
  it("takes a percentage of an amount, rounded once", () => {
    expect(t(percentOf(toDecimal("1000.00"), toDecimal("21"), 2, "half-up"))).toBe("210.00");
    expect(t(percentOf(toDecimal("0.30"), toDecimal("5"), 2, "half-up"))).toBe("0.02");
    expect(t(percentOf(toDecimal("0.30"), toDecimal("5"), 2, "half-even"))).toBe("0.02");
    expect(t(percentOf(toDecimal("0.10"), toDecimal("5"), 2, "half-even"))).toBe("0.00");
  });

  it("finds the tax already inside a gross amount", () => {
    expect(t(percentWithin(toDecimal("121.00"), toDecimal("21"), 2, "half-up"))).toBe("21.00");
    expect(t(percentWithin(toDecimal("100.00"), toDecimal("19"), 2, "half-up"))).toBe("15.97");
  });
});

describe("exactNumberText", () => {
  it("trusts a number with 15 significant digits or fewer", () => {
    expect(exactNumberText(428.4)).toBe("428.4");
    expect(exactNumberText(19)).toBe("19");
    expect(exactNumberText(0.00012)).toBe("0.00012");
  });

  it("refuses one that may already have lost digits", () => {
    expect(exactNumberText(9007199254740993)).toBeUndefined();
    expect(exactNumberText(1e21)).toBeUndefined();
    expect(exactNumberText(Number.NaN)).toBeUndefined();
  });
});
