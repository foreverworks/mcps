import { describe, expect, it } from "vitest";

import { fuse, RRF_K } from "../src/domain/rrf.js";

describe("fuse", () => {
  it("adds 1/(k + rank) over the lists, so an item both retrievers found beats one found first by one", () => {
    const fused = fuse([
      ["a", "b", "c"],
      ["c", "d", "b"],
    ]);
    expect(fused.map((f) => f.key)).toEqual(["c", "b", "a", "d"]);
    expect(fused[0]?.score).toBeCloseTo(1 / (RRF_K + 3) + 1 / (RRF_K + 1), 12);
    expect(fused.find((f) => f.key === "d")?.ranks).toEqual([undefined, 2]);
  });

  it("counts an item once per list even if a list repeats it, and orders ties by key", () => {
    const fused = fuse([["x", "x", "y"], []]);
    expect(fused.map((f) => [f.key, f.ranks[0]])).toEqual([
      ["x", 1],
      ["y", 3],
    ]);
    expect(fuse([["b"], ["a"]]).map((f) => f.key)).toEqual(["a", "b"]);
  });
});
