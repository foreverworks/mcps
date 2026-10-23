import { describe, expect, it } from "vitest";

import type { Mark } from "../src/domain/mark.js";
import { admits, folded, inClasses, ranked, relationOf, type Hit } from "../src/domain/match.js";
import { editDistance, phoneticKey, similarityOf } from "../src/domain/similarity.js";

const hit = (mark: string | null, status: Mark["status"], relation: Hit["relation"], id = mark ?? "x"): Hit => ({
  office: "US",
  id,
  mark,
  status,
  statusText: status,
  owners: [],
  classes: [9],
  link: "",
  relation,
});

describe("what counts as the same name", () => {
  it("ignores case, accents, spaces and punctuation", () => {
    expect(folded("Blue-Night ")).toBe("bluenight");
    expect(folded("Túrnip")).toBe("turnip");
    expect(relationOf("Bluenight", "BLUE NIGHT")).toBe("identical");
    expect(relationOf("Bluenight", "blue-night")).toBe("identical");
  });

  it("tells containing the name from merely similar, and a mark without words is similar at most", () => {
    expect(relationOf("Turnip", "TURNIP QPT")).toBe("contains");
    expect(relationOf("Turnip", "STURNIP")).toBe("contains");
    expect(relationOf("Turnip", "DURNIP")).toBe("similar");
    expect(relationOf("Turnip", null)).toBe("similar");
  });

  it("admits per mode", () => {
    expect(admits("exact", "identical")).toBe(true);
    expect(admits("exact", "contains")).toBe(false);
    expect(admits("word", "contains")).toBe(true);
    expect(admits("word", "similar")).toBe(false);
    expect(admits("similar", "similar")).toBe(true);
  });

  it("matches classes, any of them, and no classes means all", () => {
    expect(inClasses([7, 20], [9, 35, 42])).toBe(false);
    expect(inClasses([5, 42], [9, 35, 42])).toBe(true);
    expect(inClasses([7], [])).toBe(true);
  });

  it("ranks identical first, the marks in the way first among them, and keeps the source's order among the similar", () => {
    const order = ranked([
      hit("DURNIP", "pending", "similar", "s1"),
      hit("NABEK", "registered", "similar", "s2"),
      hit("TURNIP", "pending", "identical", "i1"),
      hit("TURNIP QPT", "registered", "contains", "c1"),
      hit("TURNIP", "registered", "identical", "i2"),
    ]).map((h) => h.id);
    expect(order).toEqual(["i2", "i1", "c1", "s1", "s2"]);
  });
});

describe("similarity", () => {
  it("scores how alike two marks are written and sound, 0 to 100, the same for every office", () => {
    expect(similarityOf("Turnip", "TURNIP")).toBe(100);
    expect(similarityOf("Turnip", "durnip")).toBe(92);
    expect(similarityOf("Turnip", "TURNIP QPT")).toBe(67);
    expect(similarityOf("Turnip", "Apple")).toBeLessThan(20);
    expect(similarityOf("Turnip", null)).toBeUndefined();
    expect(similarityOf("Turnip", "®")).toBeUndefined();
  });

  it("gives marks that sound alike one phonetic key", () => {
    expect(new Set(["Turnip", "DURNIP", "Ternip", "Durnnip"].map(phoneticKey))).toEqual(new Set(["tarnap"]));
    expect(phoneticKey("Phoenix")).toBe(phoneticKey("Fenix"));
    expect(phoneticKey("Kool")).toBe(phoneticKey("Cool"));
    expect(phoneticKey("School")).toBe(phoneticKey("Skool"));
    expect(phoneticKey("Xerox")).toBe(phoneticKey("Zerox"));
    expect(phoneticKey("Chique")).toBe(phoneticKey("Sheek"));
    expect(phoneticKey("Bluenight")).toBe(phoneticKey("BLUENITE"));
    expect(phoneticKey("Cent")).not.toBe(phoneticKey("Kent"));
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("ranks merely similar marks by the score, then the source's order", () => {
    const scored = (mark: string, id: string): Hit => ({ ...hit(mark, "registered", "similar", id), similarity: similarityOf("Turnip", mark) as number });
    expect(ranked([scored("TURNPIKE", "a"), scored("DURNIP", "b"), scored("TERNIP", "c")]).map((h) => h.id)).toEqual(["b", "c", "a"]);
  });
});
