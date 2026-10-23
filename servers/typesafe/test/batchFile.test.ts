import { describe, expect, it } from "vitest";

import { MAX_BATCH_ITEMS, parseBatchItems } from "../src/domain/batchFile.js";
import { asAppError } from "../src/domain/errors.js";

const refusal = (text: string) => {
  try {
    parseBatchItems(text);
  } catch (thrown) {
    return asAppError(thrown);
  }
  return undefined;
};

describe("parseBatchItems", () => {
  it("reads JSONL, skipping blank lines and a byte-order mark, and a JSON array", () => {
    expect(parseBatchItems('﻿{"id": "a", "state": "x"}\r\n\n{"state": "y"}\n')).toEqual([{ id: "a", state: "x" }, { state: "y" }]);
    expect(parseBatchItems('  [{"state": {"k": 1}}, {"state": [1, 2]}]')).toEqual([{ state: { k: 1 } }, { state: [1, 2] }]);
  });

  it("names the line or row that is wrong", () => {
    expect(refusal('{"state": "x"}\n{"state": "y"')).toMatchObject({ kind: "input", message: expect.stringContaining("line 2 is not JSON") });
    expect(refusal('[{"state": "x"}, {"id": "b"}]')).toMatchObject({ kind: "input", message: expect.stringContaining("row 2 has no \"state\"") });
    expect(refusal('{"state": 5}')).toMatchObject({ kind: "input" });
    // TypeSafe answers a null state as a missing one (422), so the file is refused before any row is sent.
    expect(refusal('{"state": null}')).toMatchObject({ kind: "input", message: expect.stringContaining('line 1 has no "state"') });
    expect(refusal('{"id": "", "state": "x"}')).toMatchObject({ kind: "input", message: expect.stringContaining('"id"') });
    expect(refusal('"just text"')).toMatchObject({ kind: "input" });
  });

  it("refuses an empty file and one over the cap", () => {
    expect(refusal("\n\n")).toMatchObject({ kind: "input", message: "items_file holds no rows" });
    const many = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => '{"state": "x"}').join("\n");
    expect(refusal(many)).toMatchObject({ kind: "input", message: expect.stringContaining("at most 1000") });
  });
});
