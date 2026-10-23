import { describe, expect, it } from "vitest";

import { centsArg, decimalOf, usd } from "../src/domain/cents.js";

describe("usd", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [99, "$0.99"],
    [100, "$1.00"],
    [1108, "$11.08"],
    [50000, "$500.00"],
    [-250, "-$2.50"],
    [Number.MAX_SAFE_INTEGER, "$90071992547409.91"],
  ])("%i cents is %s", (cents, dollars) => {
    expect(usd(cents)).toBe(dollars);
  });

  it("says so rather than rounding what is not a whole number of cents", () => {
    expect(usd(11.5)).toBe("11.5 (not a whole number of cents)");
  });
});

describe("decimalOf", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [1108, "11.08"],
    [-250, "-2.50"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
  ])("%i cents is %s", (cents, text) => {
    expect(decimalOf(cents)).toBe(text);
  });
});

describe("centsArg", () => {
  it("reads the _cents name, else the legacy alias, and flags a disagreement", () => {
    expect(centsArg({ cost_cents: 1108 }, "cost_cents", "cost")).toEqual({ kind: "cents", cents: 1108 });
    expect(centsArg({ cost: 1108 }, "cost_cents", "cost")).toEqual({ kind: "cents", cents: 1108 });
    expect(centsArg({ cost_cents: 1108, cost: 1108 }, "cost_cents", "cost")).toEqual({ kind: "cents", cents: 1108 });
    expect(centsArg({ cost_cents: 1108, cost: 1200 }, "cost_cents", "cost")).toEqual({ kind: "conflict" });
    expect(centsArg({}, "cost_cents", "cost")).toEqual({ kind: "absent" });
  });
});
