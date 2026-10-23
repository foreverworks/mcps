import { describe, expect, it } from "vitest";

import { makeErrorKit } from "../src/errors.js";
import { inSeries, makeFailureVerdict, OK, PERMANENT, TRANSIENT, worst } from "../src/verdict.js";

type E = { readonly kind: "auth" | "api"; readonly code: string; readonly message: string };
const kit = makeErrorKit<E>("verdict-test");
const caught = (error: E): unknown => {
  try {
    return kit.fail(error);
  } catch (thrown) {
    return thrown;
  }
};

const verdict = makeFailureVerdict<E>({
  prefix: "TEST",
  asAppError: kit.asAppError,
  needsHuman: (e) => e.kind === "auth",
  remedyFor: (e) => (e.kind === "auth" ? "re-consent" : "retry later"),
  labelOf: (e) => (e.kind === "auth" ? `${e.code}: ${e.message}` : e.message),
});

describe("the verdict line", () => {
  it("is a FAIL for what a human must fix and a WARN for what waiting fixes", () => {
    expect(verdict(caught({ kind: "auth", code: "invalid_grant", message: "revoked" }))).toEqual({
      code: PERMANENT,
      line: "TEST: FAIL invalid_grant: revoked -- re-consent",
    });
    expect(verdict(caught({ kind: "api", code: "", message: "503" }), "account=work")).toEqual({
      code: TRANSIENT,
      line: "TEST: WARN account=work 503 -- retry later",
    });
  });

  it("calls a throw it does not know a FAIL, since it is a bug", () => {
    expect(verdict(new Error("boom"))).toEqual({ code: PERMANENT, line: "TEST: FAIL unexpected: Error: boom" });
  });

  it("exits with the worst line, and runs checks one at a time, in order", async () => {
    expect(worst([OK, TRANSIENT, OK])).toBe(TRANSIENT);
    expect(worst([TRANSIENT, PERMANENT])).toBe(PERMANENT);
    expect(worst([])).toBe(OK);
    const running: number[] = [];
    const seen = await inSeries([3, 1, 2], async (n) => {
      running.push(n);
      expect(running).toHaveLength(1);
      await new Promise((r) => setTimeout(r, n));
      running.pop();
      return n * 10;
    });
    expect(seen).toEqual([30, 10, 20]);
  });
});
