import { describe, expect, it } from "vitest";

import { columnIndex, columnLetter, gridRange, parseA1, quoteSheet } from "../../src/sheets/domain/a1.js";
import { cellToWrite, exactDecimal, typedValue } from "../../src/sheets/domain/cells.js";
import { chartRequest } from "../../src/sheets/domain/chart.js";
import { asAppError, type AppError } from "../../src/sheets/domain/errors.js";
import { formatRequests } from "../../src/sheets/domain/format.js";
import { layoutRequests } from "../../src/sheets/domain/layout.js";
import { planAppend, planUpsert } from "../../src/sheets/domain/rows.js";
import type { RawCellData, RawGridData } from "../../src/sheets/domain/schema.js";
import { headerKeys, rowObject, tableOf } from "../../src/sheets/domain/table.js";

const thrownBy = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    const error = asAppError(e);
    if (error) return error;
    throw e;
  }
  throw new Error("expected a failure");
};

const text = (s: string): RawCellData => ({ effectiveValue: { stringValue: s }, formattedValue: s });
const num = (n: number, type = "NUMBER", pattern = "", shown = String(n)): RawCellData => ({
  effectiveValue: { numberValue: n },
  formattedValue: shown,
  effectiveFormat: { numberFormat: { type, pattern } },
});

describe("A1", () => {
  it("converts columns both ways, past Z", () => {
    expect([0, 25, 26, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(["A", "Z", "AA", "ZZ", "AAA"].map(columnIndex)).toEqual([0, 25, 26, 701, 702]);
  });

  it("parses cells, columns, rows, quoted sheets and a bare sheet name", () => {
    expect(parseA1("'Q3 ''24'!B2:D10")).toEqual({ sheet: "Q3 '24", startRow: 1, endRow: 10, startColumn: 1, endColumn: 4 });
    expect(parseA1("A:C")).toEqual({ startColumn: 0, endColumn: 3 });
    expect(parseA1("2:5")).toEqual({ startRow: 1, endRow: 5 });
    expect(parseA1("E2")).toEqual({ startRow: 1, endRow: 2, startColumn: 4, endColumn: 5 });
    expect(parseA1("Totals", ["Totals"])).toEqual({ sheet: "Totals" });
    expect(gridRange(parseA1("B2:C3"), 7)).toEqual({ sheetId: 7, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 3 });
  });

  it("refuses what is not a range, before any request", () => {
    expect(thrownBy(() => parseA1("A1:B2:C3"))).toMatchObject({ kind: "input" });
    expect(thrownBy(() => parseA1("Revenue"))).toMatchObject({ kind: "input" });
  });

  it("quotes every sheet title, doubling quotes", () => {
    expect(quoteSheet("It's")).toBe("'It''s'");
  });
});

describe("typed values", () => {
  it("reads dates as ISO strings in sheet-local time", () => {
    expect(typedValue(num(46293, "DATE"))).toBe("2026-09-28");
    expect(typedValue(num(46293.5, "DATE_TIME"))).toBe("2026-09-28T12:00:00");
    expect(typedValue(num(0.75, "TIME"))).toBe("18:00:00");
  });

  it("keeps numbers numbers, and gives currency its exact decimal string too", () => {
    expect(typedValue(num(0.1 + 0.2))).toBe(0.30000000000000004);
    expect(typedValue(num(1234.5, "CURRENCY", "#,##0.00 [$RON]", "1,234.50 RON"))).toEqual({
      value: 1234.5,
      amount: "1234.5",
      formatted: "1,234.50 RON",
    });
    // A symbol in the pattern is currency whatever the declared type.
    expect(typedValue(num(9.99, "NUMBER", '"€"#,##0.00', "€9.99"))).toMatchObject({ amount: "9.99" });
  });

  it("spells out exponent notation", () => {
    expect(exactDecimal(1e21)).toBe("1000000000000000000000");
    expect(exactDecimal(1.5e-7)).toBe("0.00000015");
    expect(exactDecimal(-2.5e-7)).toBe("-0.00000025");
  });

  it("reads empty cells as null, errors as errors, text and booleans as themselves", () => {
    expect(typedValue(undefined)).toBeNull();
    expect(typedValue({ effectiveValue: { errorValue: { type: "REF" } }, formattedValue: "#REF!" })).toEqual({ error: "#REF!" });
    expect(typedValue(text("00123"))).toBe("00123");
    expect(typedValue({ effectiveValue: { boolValue: false } })).toBe(false);
  });

  it("writes a value without touching the cell's format, and a date with one", () => {
    expect(cellToWrite(12.5)).toEqual({ cell: { userEnteredValue: { numberValue: 12.5 } }, fields: "userEnteredValue" });
    expect(cellToWrite("00123")).toEqual({ cell: { userEnteredValue: { stringValue: "00123" } }, fields: "userEnteredValue" });
    expect(cellToWrite("=SUM(A1:A3)").cell).toEqual({ userEnteredValue: { formulaValue: "=SUM(A1:A3)" } });
    expect(cellToWrite({ amount: "10.25" }).cell).toEqual({ userEnteredValue: { numberValue: 10.25 } });
    expect(cellToWrite({ amount: "-0.50" }).cell).toEqual({ userEnteredValue: { numberValue: -0.5 } });
    expect(() => cellToWrite({ amount: "12,50" })).toThrow();
    expect(() => cellToWrite({ amount: "1e3" })).toThrow();
    expect(() => cellToWrite({ amount: "" })).toThrow();
    // More digits than a double holds: refused, never rounded on the way in.
    expect(() => cellToWrite({ amount: "12345678901234567.89" })).toThrow();
    expect(cellToWrite("2026-09-28")).toEqual({
      cell: { userEnteredValue: { numberValue: 46293 }, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
      fields: "userEnteredValue,userEnteredFormat.numberFormat",
    });
    expect(cellToWrite("2026-09-28T12:00").cell.userEnteredValue).toEqual({ numberValue: 46293.5 });
  });
});

const grid = (rows: readonly (readonly (RawCellData | undefined)[])[]): RawGridData => ({
  rowData: rows.map((values) => ({ values: values.map((v) => v ?? {}) })),
});

const INVOICES = tableOf(
  { sheetId: 5, title: "Invoices", gridProperties: { rowCount: 4, columnCount: 5 } },
  grid([
    [text("No"), text("Client"), text("Total"), undefined, text("Client")],
    [num(1001), text("Acme"), num(100, "CURRENCY", "", "100.00 lei")],
    [],
    [num(1002), text("Beta"), num(250.5, "CURRENCY", "", "250.50 lei")],
  ]),
  0,
);

describe("the table under a header", () => {
  it("keys every column once, naming blanks by letter and suffixing repeats", () => {
    expect(headerKeys(["No", "", "No", "_row", ""])).toEqual(["No", "B", "No_2", "_row_2"]);
    expect(INVOICES.keys).toEqual(["No", "Client", "Total", "D", "Client_2"]);
  });

  it("skips empty rows, knows where the data ends, and gives each row its sheet row number", () => {
    expect(INVOICES.rows.map((r) => r.index)).toEqual([1, 3]);
    expect(INVOICES.extent).toBe(4);
    expect(rowObject(INVOICES.keys, INVOICES.rows[1] as (typeof INVOICES.rows)[number])).toEqual({
      _row: 4,
      No: 1002,
      Client: "Beta",
      Total: { value: 250.5, amount: "250.5", formatted: "250.50 lei" },
      D: null,
      Client_2: null,
    });
  });

  it("refuses an empty header row", () => {
    expect(thrownBy(() => tableOf({ sheetId: 1, title: "S" }, grid([[], [text("x")]]), 0))).toMatchObject({ kind: "input" });
  });
});

describe("row writes", () => {
  it("appends after the data, growing the grid and copying the last row's format", () => {
    const plan = planAppend(INVOICES, [{ No: 1003, Client: "Gamma", Total: 10 }]);
    expect(plan.appended).toEqual([5]);
    expect(plan.requests).toEqual([
      { appendDimension: { sheetId: 5, dimension: "ROWS", length: 1 } },
      {
        copyPaste: {
          source: { sheetId: 5, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 5 },
          destination: { sheetId: 5, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 5 },
          pasteType: "PASTE_FORMAT",
        },
      },
      {
        updateCells: {
          start: { sheetId: 5, rowIndex: 4, columnIndex: 0 },
          rows: [{ values: [{ userEnteredValue: { numberValue: 1003 } }, { userEnteredValue: { stringValue: "Gamma" } }, { userEnteredValue: { numberValue: 10 } }] }],
          fields: "userEnteredValue",
        },
      },
    ]);
  });

  it("refuses a key the header does not have", () => {
    expect(thrownBy(() => planAppend(INVOICES, [{ Nr: 1 }]))).toMatchObject({ kind: "input", message: expect.stringMatching(/"Nr"/) });
  });

  it("upserts: updates only the given columns of matching rows (never the key), appends the rest, in one list", () => {
    const plan = planUpsert(INVOICES, "No", [
      { No: "1002", Total: { amount: "300" } },
      { No: 1004, Client: "Delta" },
    ]);
    expect(plan.updated).toEqual([4]);
    expect(plan.appended).toEqual([5]);
    expect(plan.requests[0]).toEqual({
      updateCells: { start: { sheetId: 5, rowIndex: 3, columnIndex: 2 }, rows: [{ values: [{ userEnteredValue: { numberValue: 300 } }] }], fields: "userEnteredValue" },
    });
    expect(plan.requests.map((r) => Object.keys(r)[0])).toEqual(["updateCells", "appendDimension", "copyPaste", "updateCells"]);
  });

  it("splits a row's cells where the fields they set differ, so a date gets its format and nothing else loses one", () => {
    const table = tableOf({ sheetId: 1, title: "S", gridProperties: { rowCount: 10 } }, grid([[text("a"), text("when"), text("b")]]), 0);
    const plan = planAppend(table, [{ a: 1, when: "2026-09-28", b: 2 }]);
    expect(plan.requests.map((r) => r.updateCells?.fields)).toEqual(["userEnteredValue", "userEnteredValue,userEnteredFormat.numberFormat", "userEnteredValue"]);
  });

  it("refuses a key two sheet rows share, a missing key and a key given twice", () => {
    const dup = tableOf({ sheetId: 1, title: "S", gridProperties: { rowCount: 5 } }, grid([[text("k")], [text("x")], [text("x")]]), 0);
    expect(thrownBy(() => planUpsert(dup, "k", [{ k: "x" }]))).toMatchObject({ kind: "ambiguous", candidates: ["row 2", "row 3"] });
    expect(thrownBy(() => planUpsert(INVOICES, "No", [{ Client: "no key" }]))).toMatchObject({ kind: "input" });
    expect(thrownBy(() => planUpsert(INVOICES, "No", [{ No: 7 }, { No: "7" }]))).toMatchObject({ kind: "input" });
  });
});

describe("format, chart and layout requests", () => {
  const range = { sheetId: 3, startRowIndex: 0, endRowIndex: 1 };

  it("sets exactly the fields given", () => {
    expect(formatRequests(range, { bold: true, background: "#ff0000", freezeRows: 1, numberFormat: { type: "CURRENCY", pattern: "#,##0.00" } })).toEqual([
      {
        repeatCell: {
          range,
          cell: {
            userEnteredFormat: {
              numberFormat: { type: "CURRENCY", pattern: "#,##0.00" },
              textFormat: { bold: true },
              backgroundColorStyle: { rgbColor: { red: 1, green: 0, blue: 0 } },
            },
          },
          fields: "userEnteredFormat.numberFormat,userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColorStyle",
        },
      },
      { updateSheetProperties: { properties: { sheetId: 3, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    ]);
  });

  it("draws outer borders on four sides, and refuses an empty format and a bad colour", () => {
    const [borders] = formatRequests(range, { borders: { style: "SOLID", sides: ["outer"] } });
    expect(Object.keys(borders?.updateBorders ?? {}).sort()).toEqual(["bottom", "left", "range", "right", "top"]);
    expect(thrownBy(() => formatRequests(range, {}))).toMatchObject({ kind: "input" });
    expect(thrownBy(() => formatRequests(range, { background: "red" }))).toMatchObject({ kind: "input" });
  });

  it("plots series by column with the first as the domain; a bar chart's series on the bottom axis", () => {
    const data = { sheetId: 2, startRowIndex: 0, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 3 };
    const chart = chartRequest({ type: "BAR", data, anchor: { sheetId: 2, rowIndex: 1, columnIndex: 5 }, title: "T", headers: true }).addChart?.chart;
    expect(chart?.spec?.basicChart?.domains?.[0]?.domain?.sourceRange?.sources).toEqual([{ ...data, startColumnIndex: 0, endColumnIndex: 1 }]);
    expect(chart?.spec?.basicChart?.series?.map((s) => [s.series?.sourceRange?.sources?.[0]?.startColumnIndex, s.targetAxis])).toEqual([
      [1, "BOTTOM_AXIS"],
      [2, "BOTTOM_AXIS"],
    ]);
    expect(thrownBy(() => chartRequest({ type: "PIE", data, anchor: { sheetId: 2, rowIndex: 0, columnIndex: 0 }, title: "", headers: true }))).toMatchObject({
      kind: "input",
    });
  });

  it("lays out a new spreadsheet: renames the first sheet, adds the rest, bold frozen headers", () => {
    const requests = layoutRequests(0, [
      { title: "Invoices", headers: ["No", "Total"] },
      { title: "Notes", headers: [] },
    ]);
    expect(requests.map((r) => Object.keys(r)[0])).toEqual(["updateSheetProperties", "updateCells", "addSheet"]);
    expect(requests[2]?.addSheet?.properties).toMatchObject({ sheetId: 1, title: "Notes", gridProperties: { frozenRowCount: 0 } });
    expect(thrownBy(() => layoutRequests(0, [{ title: "A", headers: [] }, { title: "A", headers: [] }]))).toMatchObject({ kind: "input" });
  });
});
