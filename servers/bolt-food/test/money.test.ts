import { formatMinor } from "@foreverworks/receipts/domain";
import { describe, expect, it } from "vitest";

import { minorOr0, toMinor } from "../src/domain/money.js";

describe("money", () => {
  it("rounds float drift away the moment an amount arrives", () => {
    expect(toMinor(60.190000000000005)).toBe(6019);
    expect(minorOr0(2.35) + minorOr0(57.84)).toBe(toMinor(60.19));
  });

  it("keeps missing distinct from zero", () => {
    // An absent value used to become 0, so an order with no total_price read as
    // a free order. Only a real zero is zero.
    expect(toMinor(undefined)).toBeUndefined();
    expect(toMinor(null)).toBeUndefined();
    expect(toMinor(0)).toBe(0);
    expect(formatMinor(toMinor(undefined))).toBeUndefined();
    expect(formatMinor(toMinor(0))).toBe("0.00");
  });

  it("still treats an omitted leg as contributing nothing to a sum", () => {
    expect(minorOr0(undefined)).toBe(0);
  });
});
