import { describe, expect, it } from "vitest";

import { cnp, iban, romanianCif } from "../src/identifiers.js";

/** A valid code for a body, computed the way the check computes it, so the tests carry no real person's or company's id. */
const cifWith = (body: string): string => {
  const padded = body.padStart(9, "0");
  const sum = [...padded].reduce((s, d, i) => s + Number(d) * Number("753217532"[i]), 0);
  return `${body}${((sum * 10) % 11) % 10}`;
};

describe("romanianCif", () => {
  it("accepts a code whose control digit holds, with or without RO, and gives the digits", () => {
    const code = cifWith("1234567");
    expect(romanianCif(code)).toEqual({ ok: true, value: code });
    expect(romanianCif(`RO${code}`)).toEqual({ ok: true, value: code });
    expect(romanianCif(` ro ${code} `)).toEqual({ ok: true, value: code });
  });

  it("refuses a swapped or changed digit, and anything not shaped like one", () => {
    const code = cifWith("1234567");
    const swapped = `${code.slice(0, 2)}${code[3]}${code[2]}${code.slice(4)}`;
    expect(romanianCif(swapped).ok).toBe(false);
    expect(romanianCif(`${code.slice(0, -1)}${(Number(code.at(-1)) + 1) % 10}`).ok).toBe(false);
    expect(romanianCif("RO-123").ok).toBe(false);
    expect(romanianCif("01234567").ok).toBe(false);
  });
});

describe("cnp", () => {
  const withControl = (twelve: string): string => {
    const r = [...twelve].reduce((s, d, i) => s + Number(d) * Number("279146358279"[i]), 0) % 11;
    return `${twelve}${r === 10 ? 1 : r}`;
  };

  it("accepts a 13-digit code whose control digit holds", () => {
    const code = withControl("190010100000");
    expect(cnp(code)).toEqual({ ok: true, value: code });
  });

  it("refuses a wrong control digit or length", () => {
    const code = withControl("190010100000");
    expect(cnp(`${code.slice(0, -1)}${(Number(code.at(-1)) + 1) % 10}`).ok).toBe(false);
    expect(cnp("19001010000").ok).toBe(false);
  });
});

describe("iban", () => {
  it("accepts the standard examples, with spaces and in lower case", () => {
    expect(iban("RO49 AAAA 1B31 0075 9384 0000")).toEqual({ ok: true, value: "RO49AAAA1B31007593840000" });
    expect(iban("gb82west12345698765432")).toEqual({ ok: true, value: "GB82WEST12345698765432" });
  });

  it("refuses a changed or swapped character", () => {
    expect(iban("RO49AAAA1B31007593840001").ok).toBe(false);
    expect(iban("RO49AAAA1B31007539840000").ok).toBe(false);
    expect(iban("RO49").ok).toBe(false);
  });
});
