import { describe, expect, it } from "vitest";

import { compact } from "../src/compact.js";

describe("compact", () => {
  it("drops undefined and keeps every other falsy value", () => {
    expect(compact({ a: undefined, b: 0, c: "", d: false, e: null, f: "x" })).toEqual({ b: 0, c: "", d: false, e: null, f: "x" });
  });

  it("types a key that admitted undefined as optional, and the rest as required", () => {
    const input: { readonly name: string; readonly cif: string | undefined } = { name: "Example SRL", cif: undefined };
    const out: { readonly name: string; readonly cif?: string } = compact(input);
    expect(out).toEqual({ name: "Example SRL" });
    expect(Object.hasOwn(out, "cif")).toBe(false);
  });
});
