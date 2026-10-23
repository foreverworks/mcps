import { fileIdFrom } from "../../../editors/domain/ids.js";
import type { CellValue } from "../../domain/cells.js";
import { pickSheet, sheetLink, type SheetSummary, sheetSummary } from "../../domain/spreadsheet.js";
import { rowObject, type Table, tableOf } from "../../domain/table.js";
import type { Deps } from "../ports.js";

/** A sheet's title when one is given, else the first sheet's (one metadata read). */
export const sheetTitle = async (deps: Deps, spreadsheetId: string, sheet: string): Promise<string> =>
  sheet || (sheetSummary(pickSheet(await deps.sheets.metadata(spreadsheetId), "")).title);

/** One sheet as a table under the header in row `headerRow` (1-based). One read for the whole sheet. */
export const readTable = async (deps: Deps, spreadsheetId: string, sheet: string, headerRow: number): Promise<Table> => {
  const title = await sheetTitle(deps, spreadsheetId, sheet);
  const raw = await deps.sheets.grid(spreadsheetId, title);
  const found = (raw.sheets ?? [])[0];
  return tableOf(pickSheet(raw, title), found?.data?.[0], headerRow - 1);
};

export const listSheets = async (
  deps: Deps,
  args: { readonly spreadsheetId: string },
): Promise<{ readonly spreadsheetId: string; readonly title: string; readonly locale: string | null; readonly timeZone: string | null; readonly link: string; readonly sheets: readonly SheetSummary[] }> => {
  const id = fileIdFrom(args.spreadsheetId);
  const raw = await deps.sheets.metadata(id);
  return {
    spreadsheetId: id,
    title: raw.properties?.title ?? "",
    locale: raw.properties?.locale ?? null,
    timeZone: raw.properties?.timeZone ?? null,
    link: raw.spreadsheetUrl ?? sheetLink(id),
    sheets: (raw.sheets ?? []).flatMap((s) => (s.properties ? [sheetSummary(s.properties)] : [])),
  };
};

/**
 * Rows as objects keyed by the header, typed: numbers stay numbers, dates are
 * ISO strings, a currency cell carries its exact decimal `amount` too. Every
 * row carries `_row`, its row number in the sheet.
 */
export const readRows = async (
  deps: Deps,
  args: { readonly spreadsheetId: string; readonly sheet: string; readonly headerRow: number; readonly offset: number; readonly limit: number },
): Promise<{
  readonly sheet: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, CellValue>>[];
  readonly total: number;
  readonly nextOffset: number | null;
}> => {
  const table = await readTable(deps, fileIdFrom(args.spreadsheetId), args.sheet, args.headerRow);
  const page = table.rows.slice(args.offset, args.offset + args.limit);
  const next = args.offset + page.length;
  return {
    sheet: table.sheet,
    columns: table.keys,
    rows: page.map((row) => rowObject(table.keys, row)),
    total: table.rows.length,
    nextOffset: next < table.rows.length ? next : null,
  };
};

/** Sparse cell read for inspecting formulas and links without treating display text as their target. */
export const readSheetCells = async (
  deps: Deps,
  args: { readonly spreadsheetId: string; readonly sheet: string; readonly offset: number; readonly limit: number },
) => {
  const id = fileIdFrom(args.spreadsheetId);
  const title = await sheetTitle(deps, id, args.sheet);
  const raw = await deps.sheets.grid(id, title);
  const rows = (raw.sheets ?? [])[0]?.data?.[0]?.rowData ?? [];
  const page = rows.slice(args.offset, args.offset + args.limit);
  return { sheet: title, startRow: args.offset + 1, rows: page.map((row, index) => ({
    row: args.offset + index + 1,
    cells: (row.values ?? []).flatMap((cell, column) =>
      cell.userEnteredValue || cell.effectiveValue || cell.hyperlink || cell.textFormatRuns?.length || cell.chipRuns?.length || cell.note
        ? [{ column: column + 1, ...cell }] : []),
  })).filter(row => row.cells.length > 0), totalRows: rows.length,
    nextOffset: args.offset + page.length < rows.length ? args.offset + page.length : null };
};
