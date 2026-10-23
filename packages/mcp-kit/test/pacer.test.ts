import { describe, expect, it } from "vitest";

import { makePacer } from "../src/pacer.js";

describe("makePacer", () => {
  it("runs one call at a time with their starts spaced out, and a failure does not stall the queue", async () => {
    let clock = 10_000;
    const waits: number[] = [];
    const started: number[] = [];
    const paced = makePacer(350, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    const call = (n: number) =>
      paced(async () => {
        started.push(n);
        if (n === 2) throw new Error("boom");
        return n;
      });
    const results = await Promise.allSettled([call(1), call(2), call(3)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(started).toEqual([1, 2, 3]);
    expect(waits).toEqual([350, 350]);
  });
});
