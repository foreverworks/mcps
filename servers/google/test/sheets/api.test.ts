/**
 * Sheets' full API: the structure as A1 with every id, A1 taken back where a
 * request wants coordinates, values in any shape, and a sheet copied by title.
 * A fake port records what would go on the wire.
 */
import { describe, expect, it } from "vitest";

import type { Deps, SheetsPort } from "../../src/sheets/app/ports.js";
import { batchUpdateSpreadsheet, clearValues, copySheetTo, getSpreadsheet, getValues, searchDeveloperMetadata, updateValues } from "../../src/sheets/app/usecases/api.js";
import { SHEETS_API } from "../../src/sheets/domain/api.js";
import { asAppError } from "../../src/sheets/domain/errors.js";
import { hasA1, resolveA1 } from "../../src/sheets/domain/refs.js";
import type { RawSpreadsheet } from "../../src/sheets/domain/schema.js";
import { gridToA1, spreadsheetOutline, titlesOf } from "../../src/sheets/domain/structure.js";
import type { Deps as DriveDeps } from "../../src/drive/app/ports.js";

const failureOf = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return asAppError(e);
  }
  throw new Error("expected a failure");
};

const BOOK: RawSpreadsheet = {
  spreadsheetId: "S1",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/S1/edit",
  properties: { title: "Budget", locale: "ro_RO", timeZone: "Europe/Bucharest", autoRecalc: "ON_CHANGE" },
  sheets: [
    {
      properties: { sheetId: 0, title: "Invoices", index: 0, sheetType: "GRID", gridProperties: { rowCount: 1000, columnCount: 26, frozenRowCount: 1 } },
      merges: [{ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }],
      conditionalFormats: [
        {
          ranges: [{ sheetId: 0, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }],
          booleanRule: { condition: { type: "NUMBER_LESS", values: [{ userEnteredValue: "0" }] }, format: { textFormat: { foregroundColor: { red: 1 } } } },
        },
      ],
      protectedRanges: [{ protectedRangeId: 7, range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, description: "header", warningOnly: true }],
      charts: [{ chartId: 42, spec: { title: "Totals", basicChart: { chartType: "COLUMN" } }, position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: 7 } } } }],
      rowGroups: [{ range: { sheetId: 0, dimension: "ROWS", startIndex: 4, endIndex: 9 }, depth: 1, collapsed: true }],
    },
    { properties: { sheetId: 98, title: "Q3 '24", index: 1, hidden: true, gridProperties: { rowCount: 50, columnCount: 5 } } },
  ],
  namedRanges: [{ namedRangeId: "nr1", name: "Totals", range: { sheetId: 98, startRowIndex: 1, endRowIndex: 10, startColumnIndex: 1, endColumnIndex: 2 } }],
};

const fakes = () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string, answer: unknown) =>
    async (...args: unknown[]): Promise<any> => {
      calls.push({ method, args });
      return answer;
    };
  const sheets = {
    metadata: record("metadata", BOOK),
    get: record("get", BOOK),
    apply: record("apply", { spreadsheetId: "S1", replies: [{}, { addSheet: { properties: { sheetId: 5, title: "New" } } }] }),
    getValues: record("getValues", {
      valueRanges: [
        { range: "Invoices!A1:B3", majorDimension: "ROWS", values: [["a", "b"], ["c", "d"], ["e", "f"]] },
        { range: "'Q3 ''24'!A1:A2", majorDimension: "ROWS", values: [["x"], ["y"]] },
      ],
    }),
    copySheet: record("copySheet", { sheetId: 123, title: "Copy of Q3 '24", index: 3 }),
    getValuesByDataFilter: record("getValuesByDataFilter", {
      valueRanges: [{ valueRange: { range: "Invoices!A2:B3", majorDimension: "ROWS", values: [["a", 1]] }, dataFilters: [{ developerMetadataLookup: { metadataKey: "rows" } }] }],
    }),
    updateValuesByDataFilter: record("updateValuesByDataFilter", { totalUpdatedCells: 2, responses: [{ updatedRange: "Invoices!A2:B2", updatedCells: 2 }] }),
    clearValuesByDataFilter: record("clearValuesByDataFilter", { clearedRanges: ["Invoices!A2:B3"] }),
    searchDeveloperMetadata: record("searchDeveloperMetadata", {
      matchedDeveloperMetadata: [
        { developerMetadata: { metadataId: 5, metadataKey: "rows", metadataValue: "q3", visibility: "DOCUMENT", location: { locationType: "ROW", dimensionRange: { sheetId: 0, dimension: "ROWS", startIndex: 1, endIndex: 3 } } } },
      ],
    }),
    getDeveloperMetadata: record("getDeveloperMetadata", { metadataId: 6, metadataKey: "book", visibility: "PROJECT", location: { locationType: "SPREADSHEET", spreadsheet: true } }),
  } as unknown as SheetsPort;
  const deps: Deps = { account: "work", sheets, drive: {} as DriveDeps };
  return { deps, calls };
};

describe("GridRange as A1", () => {
  const titles = titlesOf(BOOK);
  it("reads cells, whole columns, whole rows, open ends and whole sheets", () => {
    expect(gridToA1({ sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 3 }, titles)).toBe("'Invoices'!A1:C1");
    expect(gridToA1({ sheetId: 0, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 2 }, titles)).toBe("'Invoices'!B5");
    expect(gridToA1({ sheetId: 0, startColumnIndex: 3, endColumnIndex: 4 }, titles)).toBe("'Invoices'!D:D");
    expect(gridToA1({ sheetId: 0, startRowIndex: 1, endRowIndex: 3 }, titles)).toBe("'Invoices'!2:3");
    expect(gridToA1({ sheetId: 0, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }, titles)).toBe("'Invoices'!D2:D1000");
    expect(gridToA1({ sheetId: 98 }, titles)).toBe("'Q3 ''24'");
  });
});

describe("the outline", () => {
  it("lists each sheet's ids and structures as A1, the named ranges and nothing empty", () => {
    const out = spreadsheetOutline(BOOK) as Record<string, any>;
    expect(out).toMatchObject({ spreadsheetId: "S1", title: "Budget", locale: "ro_RO", namedRanges: [{ namedRangeId: "nr1", name: "Totals", range: "'Q3 ''24'!B2:B10" }] });
    expect(out.autoRecalc).toBeUndefined();
    expect(out.sheets[0]).toMatchObject({
      sheetId: 0,
      rows: 1000,
      columns: 26,
      frozenRows: 1,
      merges: ["'Invoices'!A1:C1"],
      conditionalFormats: [{ index: 0, ranges: ["'Invoices'!D2:D1000"], booleanRule: { format: { textFormat: { foregroundColor: "#ff0000" } } } }],
      protectedRanges: [{ protectedRangeId: 7, range: "'Invoices'!1:1", description: "header", warningOnly: true }],
      charts: [{ chartId: 42, title: "Totals", type: "COLUMN", position: "'Invoices'!H2" }],
      rowGroups: [{ range: "'Invoices'!5:9", depth: 1, collapsed: true }],
    });
    expect(out.sheets[1]).toEqual({ sheetId: 98, title: "Q3 '24", index: 1, hidden: true, rows: 50, columns: 5 });
  });

  it("refuses grid data in the outline, and reads raw with ranges and a field mask", async () => {
    const { deps, calls } = fakes();
    expect(await failureOf(getSpreadsheet(deps, { spreadsheetId: "S1", format: "outline", ranges: [], dataFilters: [], includeGridData: true, fields: "", maxChars: 60_000 }))).toMatchObject({ kind: "input" });
    await getSpreadsheet(deps, { spreadsheetId: "S1", format: "raw", ranges: ["Invoices!A1:B2"], dataFilters: [], includeGridData: true, fields: "sheets(data)", maxChars: 60_000 });
    expect(calls.at(-1)).toEqual({ method: "get", args: ["S1", { ranges: ["Invoices!A1:B2"], includeGridData: true, fields: "sheets(data)" }] });
  });
});

describe("A1 in requests", () => {
  const sheets = new Map([
    ["Invoices", 0],
    ["Q3 '24", 98],
  ]);

  it("becomes a GridRange, a GridCoordinate or a DimensionRange wherever the schema puts one", () => {
    const requests = [
      { repeatCell: { range: "Invoices!A1:D1", cell: {}, fields: "userEnteredFormat" } },
      { updateCells: { start: "'Q3 ''24'!B3", rows: [], fields: "userEnteredValue" } },
      { insertDimension: { range: "Invoices!3:5", inheritFromBefore: true } },
      { deleteDimension: { range: "Invoices!B:D" } },
      { addConditionalFormatRule: { rule: { ranges: ["Invoices!D:D", { sheetId: 0 }] }, index: 0 } },
      { updateSheetProperties: { properties: { sheetId: 0, title: "A1:B2" }, fields: "title" } },
    ];
    expect(hasA1(SHEETS_API, requests)).toBe(true);
    const resolved = resolveA1(SHEETS_API, requests, sheets);
    expect(resolved[0]).toEqual({ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 }, cell: {}, fields: "userEnteredFormat" } });
    expect(resolved[1]).toEqual({ updateCells: { start: { sheetId: 98, rowIndex: 2, columnIndex: 1 }, rows: [], fields: "userEnteredValue" } });
    expect(resolved[2]).toEqual({ insertDimension: { range: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 5 }, inheritFromBefore: true } });
    expect(resolved[3]).toEqual({ deleteDimension: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 4 } } });
    expect(resolved[4]).toEqual({ addConditionalFormatRule: { rule: { ranges: [{ sheetId: 0, startColumnIndex: 3, endColumnIndex: 4 }, { sheetId: 0 }] }, index: 0 } });
    // A string that is a title, not a range, is left alone.
    expect(resolved[5]).toEqual(requests[5]);
  });

  it("refuses A1 that names no sheet, an unknown sheet, or the wrong shape, listing each", async () => {
    const failure = await failureOf(() =>
      resolveA1(
        SHEETS_API,
        [{ repeatCell: { range: "A1:B2", cell: {}, fields: "*" } }, { updateCells: { start: "Nope!A1", fields: "*" } }, { insertDimension: { range: "Invoices!A1:B2" } }, { updateCells: { start: "Invoices!A1:B2", fields: "*" } }],
        sheets,
      ),
    );
    expect(failure?.message).toContain('requests[0].repeatCell.range: "A1:B2" names no sheet');
    expect(failure?.message).toContain('requests[1].updateCells.start: no sheet "Nope"');
    expect(failure?.message).toContain("requests[2].insertDimension.range: \"Invoices!A1:B2\" is neither whole rows");
    expect(failure?.message).toContain("requests[3].updateCells.start: \"Invoices!A1:B2\" is not one cell");
  });

  it("reads the sheet ids only when a request uses A1, then checks the schema and sends one batch", async () => {
    const { deps, calls } = fakes();
    const done = await batchUpdateSpreadsheet(deps, {
      spreadsheetId: "https://docs.google.com/spreadsheets/d/S1/edit",
      requests: [{ autoResizeDimensions: { dimensions: "Invoices!A:C" } }, { addSheet: { properties: { title: "New" } } }],
    });
    expect(done).toMatchObject({ spreadsheetId: "S1", applied: 2, replies: [{ request: 1, addSheet: { properties: { sheetId: 5, title: "New" } } }] });
    expect(calls.map((c) => c.method)).toEqual(["metadata", "apply"]);
    expect(calls[1]?.args[1]).toEqual([{ autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 3 } } }, { addSheet: { properties: { title: "New" } } }]);

    const plain = fakes();
    await batchUpdateSpreadsheet(plain.deps, { spreadsheetId: "S1", requests: [{ deleteSheet: { sheetId: 98 } }] });
    expect(plain.calls.map((c) => c.method)).toEqual(["apply"]);
    expect(await failureOf(batchUpdateSpreadsheet(plain.deps, { spreadsheetId: "S1", requests: [{ deleteSheet: { sheet: 98 } }] }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("did you mean sheetId?"),
    });
    expect(plain.calls).toHaveLength(1);
  });
});

describe("values and copies", () => {
  it("cuts a large read at a row, saying how many rows each cut range had", async () => {
    const { deps } = fakes();
    const read = await getValues(deps, { spreadsheetId: "S1", ranges: ["Invoices!A1:B3", "'Q3 ''24'!A1:A2"], dataFilters: [], valueRenderOption: "FORMULA", dateTimeRenderOption: "FORMATTED_STRING", majorDimension: "ROWS", maxChars: 22 });
    expect(read).toEqual({
      spreadsheetId: "S1",
      truncated: true,
      valueRanges: [
        { range: "Invoices!A1:B3", majorDimension: "ROWS", values: [["a", "b"], ["c", "d"]], totalRows: 3 },
        { range: "'Q3 ''24'!A1:A2", majorDimension: "ROWS", values: [], totalRows: 2 },
      ],
    });
  });

  it("copies a sheet named by title or id, into the same spreadsheet when no destination is given", async () => {
    const { deps, calls } = fakes();
    expect(await copySheetTo(deps, { spreadsheetId: "S1", sheet: "q3 '24", destinationId: "" })).toMatchObject({ spreadsheetId: "S1", sheetId: 123, title: "Copy of Q3 '24" });
    await copySheetTo(deps, { spreadsheetId: "S1", sheet: "98", destinationId: "https://docs.google.com/spreadsheets/d/S2/edit" });
    expect(calls.filter((c) => c.method === "copySheet").map((c) => c.args)).toEqual([
      ["S1", 98, "S1"],
      ["S1", 98, "S2"],
    ]);
  });
});

describe("data filters and developer metadata", () => {
  const lookup = { developerMetadataLookup: { metadataKey: "rows" } };

  it("reads, writes and clears the cells filters choose, checked against the schema first", async () => {
    const { deps, calls } = fakes();
    const read = await getValues(deps, { spreadsheetId: "S1", ranges: [], dataFilters: [lookup], valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING", majorDimension: "ROWS", maxChars: 10_000 });
    expect(read.valueRanges).toEqual([{ range: "Invoices!A2:B3", majorDimension: "ROWS", values: [["a", 1]], dataFilters: [lookup] }]);
    await updateValues(deps, { spreadsheetId: "S1", data: [{ range: "", dataFilter: lookup, values: [["b", 2]] }], valueInputOption: "RAW", majorDimension: "ROWS", includeValuesInResponse: false });
    expect(calls.at(-1)).toMatchObject({ method: "updateValuesByDataFilter", args: ["S1", [{ dataFilter: lookup, values: [["b", 2]] }], { valueInputOption: "RAW" }] });
    expect(await clearValues(deps, { spreadsheetId: "S1", ranges: [], dataFilters: [{ a1Range: "Invoices!A2:B3" }] })).toEqual({ spreadsheetId: "S1", clearedRanges: ["Invoices!A2:B3"] });
    expect(await failureOf(getValues(deps, { spreadsheetId: "S1", ranges: [], dataFilters: [{ a1range: "x" }], valueRenderOption: "FORMULA", dateTimeRenderOption: "FORMATTED_STRING", majorDimension: "ROWS", maxChars: 10 }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("did you mean a1Range?"),
    });
    expect(await failureOf(clearValues(deps, { spreadsheetId: "S1", ranges: ["Invoices!A1"], dataFilters: [lookup] }))).toMatchObject({ kind: "input" });
    expect(
      await failureOf(updateValues(deps, { spreadsheetId: "S1", data: [{ range: "Invoices!A1", values: [[1]] }, { range: "", dataFilter: lookup, values: [[2]] }], valueInputOption: "RAW", majorDimension: "ROWS", includeValuesInResponse: false })),
    ).toMatchObject({ message: expect.stringContaining("one way throughout") });
  });

  it("finds developer metadata by filter or id, saying where each is attached", async () => {
    const { deps } = fakes();
    expect(await searchDeveloperMetadata(deps, { spreadsheetId: "S1", dataFilters: [lookup] })).toEqual({
      spreadsheetId: "S1",
      matches: [{ metadataId: 5, key: "rows", value: "q3", visibility: "DOCUMENT", location: "'Invoices'!2:3" }],
    });
    expect(await searchDeveloperMetadata(deps, { spreadsheetId: "S1", metadataId: 6, dataFilters: [] })).toMatchObject({ matches: [{ metadataId: 6, location: "spreadsheet" }] });
    expect(await failureOf(searchDeveloperMetadata(deps, { spreadsheetId: "S1", dataFilters: [] }))).toMatchObject({ kind: "input" });
  });
});
