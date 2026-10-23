import { describe, expect, it, vi } from "vitest";
import { readSheetCells } from "../../src/sheets/app/usecases/read.js";
import { linkCells } from "../../src/sheets/app/usecases/links.js";
import { writeRange } from "../../src/sheets/app/usecases/cells.js";
import type { Deps } from "../../src/sheets/app/ports.js";

describe("sparse cell reads", () => {
  it("retains formula targets, rich links and physical row positions across pages", async () => {
    const linked = { userEnteredValue: { formulaValue: '=HYPERLINK("https://example.com", "Invoice")' }, formattedValue: "Invoice", hyperlink: "https://example.com" };
    const rich = { userEnteredValue: { stringValue: "Two files" }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: "https://example.com/two" } } }] };
    const grid = vi.fn(async () => ({ sheets: [{ data: [{ rowData: [{}, { values: [{}, linked] }, { values: [rich] }] }] }] }));
    const deps = { sheets: { grid } } as unknown as Deps;
    const first = await readSheetCells(deps, { spreadsheetId: "test", sheet: "Ledger", offset: 0, limit: 2 });
    expect(first.rows).toEqual([{ row: 2, cells: [{ column: 2, ...linked }] }]);
    expect(first.nextOffset).toBe(2);
    const next = await readSheetCells(deps, { spreadsheetId: "test", sheet: "Ledger", offset: 2, limit: 2 });
    expect(next.rows).toEqual([{ row: 3, cells: [{ column: 1, ...rich }] }]);
    expect(next.nextOffset).toBeNull();
  });
});

describe("linking cells", () => {
  const input = { spreadsheetId: "test", sheet: "Ledger", links: [{ row: 1, column: 1, expectedText: "INV-0001", url: "https://example.com/file" }] };
  it("writes only the link format and refuses a stale value before the batch", async () => {
    const batchUpdate = vi.fn(async () => ({}));
    const grid = vi.fn(async () => ({ sheets: [{ properties: { sheetId: 7 }, data: [{ rowData: [{ values: [{ userEnteredValue: { stringValue: "INV-0001" } }] }] }] }] }));
    const deps = { sheets: { grid, batchUpdate } } as unknown as Deps;
    await linkCells(deps, input);
    expect(batchUpdate.mock.calls[0]).toEqual(["test", [{ updateCells: { start: { sheetId: 7, rowIndex: 0, columnIndex: 0 }, rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: "https://example.com/file" } } } }] }], fields: "userEnteredFormat.textFormat.link" } }]]);
    batchUpdate.mockClear();
    await expect(linkCells(deps, { ...input, links: [{ ...input.links[0]!, expectedText: "old" }] })).rejects.toMatchObject({ error: { kind: "input" } });
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});

describe("writing a range", () => {
  it("needs the sheet named, and returns what the cells held before", async () => {
    const readValues = vi.fn(async () => ({ values: [["=A1*2", 5, "extra"], ["old"]] }));
    const writeValues = vi.fn(async () => ({ updatedRange: "Ledger!A1:B2", updatedRows: 2, updatedColumns: 2, updatedCells: 4 }));
    const deps = { sheets: { readValues, writeValues } } as unknown as Deps;
    await expect(writeRange(deps, { spreadsheetId: "test", range: "A1:B2", values: [[1, 2]] })).rejects.toMatchObject({ error: { kind: "input" } });
    expect(writeValues).not.toHaveBeenCalled();
    const out = await writeRange(deps, { spreadsheetId: "test", range: "Ledger!A1:B2", values: [[1, 2], [3, 4]] });
    expect(out).toMatchObject({ updatedCells: 4, before: [["=A1*2", 5], ["old"]] });
  });
});
