import { makeErrorKit } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import {
  addDays,
  commonRemedy,
  containsIgnoringCase,
  currencyOf,
  daysBetween,
  fail,
  formatMinor,
  inputError,
  inRange,
  isIsoDate,
  joinErrors,
  jwtClaims,
  keptItemCount,
  localMoment,
  parseBankAmount,
  parseRange,
  settledSince,
  utcDate,
} from "../src/domain/index.js";

const DAY = 86_400_000;

describe("money", () => {
  it("formats minor units as a decimal string, sign and small amounts included", () => {
    expect(formatMinor(4250)).toBe("42.50");
    expect(formatMinor(123456)).toBe("1234.56");
    expect(formatMinor(-35)).toBe("-0.35");
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(0)).toBe("0.00");
    expect(formatMinor(undefined)).toBeUndefined();
  });

  it("parses what a bank export writes, and refuses what it does not", () => {
    expect(parseBankAmount("42.50")).toBe(4250);
    expect(parseBankAmount("42,50")).toBe(4250);
    expect(parseBankAmount("-42,50")).toBe(-4250);
    expect(parseBankAmount("-42.5")).toBe(-4250);
    expect(parseBankAmount(" 42 ")).toBe(4200);
    for (const text of ["42.505", "1,234.56", "42.50 RON", ""]) expect(parseBankAmount(text)).toBeUndefined();
  });

  it("reads back what it printed", () => {
    for (const minor of [0, 5, -35, 4250, 123456]) expect(parseBankAmount(formatMinor(minor))).toBe(minor);
  });

  it("normalises a currency code, and keeps an absent one pairing with nothing", () => {
    expect(currencyOf("ron")).toBe("RON");
    expect(currencyOf(undefined)).toBe("");
  });
});

describe("dates", () => {
  it("files a just-after-midnight order on its local date in the zone it is given, and keeps the UTC date apart", () => {
    // 21:30 UTC on the 13th is 00:30 on the 14th in Bucharest's summer time.
    const at = Date.parse("2026-07-13T21:30:00Z");
    expect(localMoment(at, "Europe/Bucharest")).toEqual({ date: "2026-07-14", time: "00:30" });
    expect(utcDate(at)).toBe("2026-07-13");
    // Winter time is UTC+2.
    expect(localMoment(Date.parse("2026-01-15T22:10:00Z"), "Europe/Bucharest")).toEqual({ date: "2026-01-16", time: "00:10" });
    // The same instant elsewhere is another day and time.
    expect(localMoment(at, "America/New_York")).toEqual({ date: "2026-07-13", time: "17:30" });
    expect(localMoment(at, "UTC")).toEqual({ date: "2026-07-13", time: "21:30" });
  });

  it("does calendar arithmetic across month ends and leap days", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(daysBetween("2026-03-10", "2026-03-12")).toBe(2);
    expect(daysBetween("2026-03-10", "2026-03-09")).toBe(-1);
  });

  it("rejects dates that only look valid", () => {
    expect(isIsoDate("2026-03-10")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-3-10")).toBe(false);
  });
});

describe("parseRange", () => {
  const thrownKind = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return joinErrors(makeErrorKit<never>("test")).asAppError(e)?.kind;
    }
    return undefined;
  };

  it("accepts an open or closed range", () => {
    expect(parseRange(undefined, undefined)).toEqual({});
    expect(parseRange("2026-08-01", "2026-08-31", 93)).toEqual({ since: "2026-08-01", until: "2026-08-31" });
  });

  it("refuses bad dates, reversed ranges, and spans over the cap", () => {
    expect(thrownKind(() => parseRange("2026-8-1", undefined))).toBe("input");
    expect(thrownKind(() => parseRange("2026-09-02", "2026-09-01"))).toBe("input");
    expect(thrownKind(() => parseRange("2026-01-01", "2026-12-31", 93))).toBe("input");
    expect(thrownKind(() => parseRange("2026-01-01", undefined, 93))).toBe("input");
  });

  it("admits a date by either end, and everything past an open one", () => {
    expect(inRange("2026-03-10", { since: "2026-03-10", until: "2026-03-10" })).toBe(true);
    expect(inRange("2026-03-09", { since: "2026-03-10" })).toBe(false);
    expect(inRange("2030-01-01", {})).toBe(true);
  });
});

describe("errors", () => {
  type Own = { readonly kind: "auth"; readonly message: string };
  const a = joinErrors(makeErrorKit<Own>("serverA"));
  const b = joinErrors(makeErrorKit<Own>("serverB"));
  const caught = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it("keeps a server's own failures in its own namespace", () => {
    const thrown = caught(() => a.fail({ kind: "auth", message: "refused" }));
    expect(a.asAppError(thrown)).toEqual({ kind: "auth", message: "refused" });
    expect(b.asAppError(thrown)).toBeUndefined();
  });

  it("shares the common ones, whose remedy is the same in every server", () => {
    const thrown = caught(() => fail(inputError("bad")));
    expect(a.asAppError(thrown)).toEqual({ kind: "input", message: "bad" });
    expect(b.asAppError(caught(() => a.fail(inputError("bad"))))).toEqual({ kind: "input", message: "bad" });
    expect(commonRemedy({ kind: "not_found", message: "" })).toBe("check the id against list_orders");
  });
});

describe("small rules", () => {
  it("matches a name case-insensitively, and everything when there is no query", () => {
    expect(containsIgnoringCase("Pizza Place", "PIZZA")).toBe(true);
    expect(containsIgnoringCase(undefined, undefined)).toBe(true);
    expect(containsIgnoringCase(undefined, "x")).toBe(false);
    expect(containsIgnoringCase(undefined, "")).toBe(true);
  });

  it("settles an order a full week after its final state, not before", () => {
    expect(settledSince(0, 7 * DAY - 1)).toBe(false);
    expect(settledSince(0, 7 * DAY)).toBe(true);
  });

  it("counts the lines that were kept", () => {
    const receipt = { orderId: 1, state: "delivered", charged: {}, items: [{ adjustment: "removed" }, { adjustment: "replacement" }, {}] };
    expect(keptItemCount(receipt)).toBe(2);
  });

  it("reads a JWT's claims without verifying it, and nothing from what is not one", () => {
    const jwt = (claims: unknown) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
    expect(jwtClaims(jwt({ exp: 1, data: { user_id: 42 } }))).toEqual({ exp: 1, data: { user_id: 42 } });
    expect(jwtClaims("not-a-jwt")).toBeUndefined();
    expect(jwtClaims(jwt(null))).toBeUndefined();
    expect(jwtClaims("h.!!!.s")).toBeUndefined();
  });
});
