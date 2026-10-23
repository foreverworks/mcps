import { describe, expect, it } from "vitest";

import { csvOf } from "../src/csv.js";

describe("csvOf", () => {
  it("quotes every cell, doubles inner quotes and keeps a header for no rows", () => {
    expect(csvOf(["a", "b"], [{ a: 'Pizza "Diavola", 32cm', b: undefined }, { a: "x", b: 2 }])).toBe('a,b\n"Pizza ""Diavola"", 32cm",""\n"x","2"\n');
    expect(csvOf(["a"], [])).toBe("a\n");
  });

  it("defuses what a spreadsheet would run as a formula, and leaves negative amounts alone", () => {
    const rows = [{ v: "=HYPERLINK(\"http://x\")" }, { v: "+40 700" }, { v: "@SUM(A1)" }, { v: "-cmd" }, { v: "-12.50" }, { v: "-.5" }, { v: "a=b" }];
    expect(csvOf(["v"], rows).split("\n").slice(1, -1)).toEqual([
      '"\'=HYPERLINK(""http://x"")"',
      "\"'+40 700\"",
      "\"'@SUM(A1)\"",
      "\"'-cmd\"",
      '"-12.50"',
      '"-.5"',
      '"a=b"',
    ]);
  });
});
