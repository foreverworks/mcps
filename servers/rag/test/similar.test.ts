import { describe, expect, it } from "vitest";

import { compare, rank, samplePositions, scoreOf, type Compared } from "../src/domain/similar.js";
import { memoryStore } from "./memoryStore.js";
import { fillSimilar, similarCases } from "./similarSuite.js";

const NAMES = { docs: "docs", elsewhere: "elsewhere", long: "long", near: "near" } as const;

let opened: Promise<{ readonly store: ReturnType<typeof memoryStore>; readonly names: typeof NAMES }> | undefined;
const open = () =>
  (opened ??= (async () => {
    const store = memoryStore();
    await fillSimilar(store, NAMES);
    return { store, names: NAMES };
  })());

describe("similar, through the in-memory store", () => {
  similarCases(open);
});

describe("samplePositions", () => {
  it("takes every chunk of a document of at most 64, and 64 spread evenly with the first and last of a longer one", () => {
    expect(samplePositions(0)).toEqual([]);
    expect(samplePositions(3)).toEqual([0, 1, 2]);
    expect(samplePositions(64)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    for (const count of [65, 70, 127, 128, 1000, 10_001]) {
      const positions = samplePositions(count);
      expect(positions).toHaveLength(64);
      expect(positions[0]).toBe(0);
      expect(positions.at(-1)).toBe(count - 1);
      // Strictly increasing, so none is taken twice, and no gap is wider than one step rounded up.
      positions.slice(1).forEach((p, i) => {
        const gap = p - (positions[i] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(Math.ceil((count - 1) / 63));
      });
    }
  });

  it("rounds half up, in integers: 65 chunks take every position but one", () => {
    // The step is 64/63, so position k is round(k * 64 / 63): up to k = 31 it is k, and from k = 32 on it runs one ahead (32.5 rounds up to 33).
    const positions = samplePositions(65);
    expect(positions.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(positions[32]).toBe(33);
    expect(new Set(Array.from({ length: 65 }, (_, i) => i).filter((i) => !positions.includes(i)))).toEqual(new Set([32]));
  });
});

describe("compare", () => {
  it("is forward, backward and the best pair of a matrix of cosines", () => {
    // Rows are the source's chunks, columns the other's.
    const result = compare([
      [0.9, 0.1, 0.2],
      [0.3, 0.8, 0.95],
    ]);
    expect(result?.forward).toBeCloseTo((0.9 + 0.95) / 2);
    expect(result?.backward).toBeCloseTo((0.9 + 0.8 + 0.95) / 3);
    expect(result?.best).toEqual({ value: 0.95, row: 1, column: 2 });
  });

  it("gives the same score from either side, and 1 for identical documents", () => {
    const m = [
      [1, 0.2],
      [0.2, 1],
      [0.5, 0.4],
    ];
    const transposed = [0, 1].map((j) => m.map((row) => row[j] ?? 0));
    const a = compare(m);
    const b = compare(transposed);
    expect(scoreOf(a?.forward ?? 0, a?.backward ?? 0)).toBeCloseTo(scoreOf(b?.forward ?? 0, b?.backward ?? 0));
    expect(a?.forward).toBeCloseTo(b?.backward ?? 0);
    const same = compare([
      [1, 0],
      [0, 1],
    ]);
    expect(scoreOf(same?.forward ?? 0, same?.backward ?? 0)).toBe(1);
  });

  it("breaks a tie for the best pair by the lowest row, then the lowest column, and has no answer without chunks", () => {
    expect(compare([[0.5, 0.5], [0.5, 0.5]])?.best).toEqual({ value: 0.5, row: 0, column: 0 });
    expect(compare([[0.2, 0.7], [0.7, 0.1]])?.best).toEqual({ value: 0.7, row: 0, column: 1 });
    expect(compare([])).toBeUndefined();
    expect(compare([[], []])).toBeUndefined();
  });
});

describe("rank", () => {
  const doc = (source: string, forward: number, backward: number, chunks = 1): Compared => ({
    source,
    chunks,
    forward,
    backward,
    best: { value: Math.max(forward, backward), chunk: { id: `${source}#0`, location: "" }, sourceChunk: { id: "s#0", location: "" } },
  });

  it("orders by the rounded score and then by source, drops what is below min_score, and cuts at limit", () => {
    const ranked = rank([doc("b", 0.5, 0.5), doc("a", 0.50001, 0.5), doc("c", 0.9, 0.9), doc("d", 0.1, 0.1)], { minScore: 0.2, limit: 3 });
    // a and b both read 0.5 once rounded, so the source decides; d is below the floor.
    expect(ranked.map((r) => [r.source, r.score])).toEqual([
      ["c", 0.9],
      ["a", 0.5],
      ["b", 0.5],
    ]);
    expect(rank([doc("a", 1.0000001, 0.9999999)], { minScore: 1, limit: 5 })[0]).toMatchObject({ score: 1, forward: 1, backward: 1 });
    expect(rank([doc("a", 0.3, 0.3)], { minScore: 0.31, limit: 5 })).toEqual([]);
  });

  it("says a document was sampled when it has more chunks than a comparison takes", () => {
    const ranked = rank([doc("a", 1, 1, 64), doc("b", 1, 1, 65), doc("c", 1, 1, 1)], { minScore: 0, limit: 5 });
    expect(ranked.map((r) => [r.source, r.sampled])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });
});
