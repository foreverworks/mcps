import { describe, expect, it } from "vitest";

import { addUsage } from "../src/domain/batch.js";
import { certaintyOf, verdictOf } from "../src/domain/verdicts.js";

describe("addUsage", () => {
  it("adds the counts, and leaves a total unknown when any part was unreported", () => {
    expect(addUsage([{ input_tokens: 300, output_tokens: 20 }, { input_tokens: 296, output_tokens: 21 }])).toEqual({ input_tokens: 596, output_tokens: 41 });
    expect(addUsage([{ input_tokens: 300, output_tokens: 20 }, { input_tokens: null, output_tokens: 21 }])).toEqual({ input_tokens: null, output_tokens: 41 });
    expect(addUsage([])).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

describe("verdicts", () => {
  it("rounds the certainty down to three places, so 0.95 is 0.9 and never 0.899, and gates strictly above", () => {
    expect(certaintyOf({ type: "noul", noul: 0.95 })).toBe(0.9);
    expect(certaintyOf({ type: "noul", noul: 0.05 })).toBe(0.9);
    expect(certaintyOf({ type: "noul", noul: 0.5 })).toBe(0);
    expect(certaintyOf({ type: "noul", noul: 0.95049 })).toBe(0.9);
    expect(certaintyOf({ type: "choice", choice: "a", confidence: 0.8009, probabilities: { a: 0.9, b: 0.1 } })).toBe(0.8);
    const t = { act_above: 0.8, review_above: 0.5 };
    expect([verdictOf(0.801, t), verdictOf(0.8, t), verdictOf(0.501, t), verdictOf(0.5, t)]).toEqual(["act", "review", "review", "abstain"]);
  });
});
