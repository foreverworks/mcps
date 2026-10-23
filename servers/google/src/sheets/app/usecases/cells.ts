import { fileIdFrom } from "../../../editors/domain/ids.js";
import { columnIndex, gridRange, parseA1 } from "../../domain/a1.js";
import { chartRequest, type ChartType } from "../../domain/chart.js";
import { fail, inputError } from "../../domain/errors.js";
import { type FormatSpec, formatRequests } from "../../domain/format.js";
import type { GridRangeOut, RawSpreadsheet } from "../../domain/schema.js";
import { pickSheet, sheetSummary } from "../../domain/spreadsheet.js";
import type { Deps } from "../ports.js";

/** An A1 range as a GridRange, its sheet looked up by name (or the first sheet when the range names none). */
const rangeIn = (meta: RawSpreadsheet, range: string): GridRangeOut => {
  const names = (meta.sheets ?? []).map((s) => s.properties?.title ?? "");
  const a1 = parseA1(range, names);
  return gridRange(a1, sheetSummary(pickSheet(meta, a1.sheet ?? "")).sheetId);
};

/**
 * Values or formulas into a range, parsed as if typed (USER_ENTERED): "=SUM(B2:B9)" is a formula, "2026-09-28" a date.
 *
 * The range must name its sheet: Sheets reads a bare "A1:B2" as the FIRST
 * sheet, whichever that is today. What the cells held before is read first
 * and returned, as entered (formulas as formulas), so an overwrite can be put
 * back by writing `before` to the same range.
 */
export const writeRange = async (
  deps: Deps,
  args: { readonly spreadsheetId: string; readonly range: string; readonly values: readonly (readonly (string | number | boolean | null)[])[] },
) => {
  if (!args.range.includes("!")) return fail(inputError(`"${args.range}" names no sheet; write it as Sheet1!${args.range} (list_sheets names them)`));
  const id = fileIdFrom(args.spreadsheetId);
  const width = Math.max(0, ...args.values.map((row) => row.length));
  const held = (await deps.sheets.readValues(id, args.range)).values ?? [];
  const before = held.slice(0, args.values.length).map((row) => row.slice(0, width));
  const written = await deps.sheets.writeValues(id, args.range, args.values);
  return {
    updatedRange: written.updatedRange ?? args.range,
    updatedRows: written.updatedRows ?? 0,
    updatedColumns: written.updatedColumns ?? 0,
    updatedCells: written.updatedCells ?? 0,
    before,
  };
};

export const formatRange = async (deps: Deps, args: { readonly spreadsheetId: string; readonly range: string; readonly format: FormatSpec }) => {
  const id = fileIdFrom(args.spreadsheetId);
  const requests = formatRequests(rangeIn(await deps.sheets.metadata(id), args.range), args.format);
  await deps.sheets.batchUpdate(id, requests);
  return { range: args.range, requests: requests.length };
};

export const addChart = async (
  deps: Deps,
  args: {
    readonly spreadsheetId: string;
    readonly type: ChartType;
    readonly dataRange: string;
    /** Column letters; empty means every column of the data after the first. */
    readonly seriesColumns: readonly string[];
    readonly anchorCell: string;
    readonly title: string;
    readonly headers: boolean;
  },
) => {
  const id = fileIdFrom(args.spreadsheetId);
  const meta = await deps.sheets.metadata(id);
  const data = rangeIn(meta, args.dataRange);
  const anchor = rangeIn(meta, args.anchorCell);
  if (anchor.startRowIndex == null || anchor.startColumnIndex == null) return fail(inputError(`anchor_cell "${args.anchorCell}" must name one cell, e.g. E2`));
  const reply = await deps.sheets.batchUpdate(id, [
    chartRequest({
      type: args.type,
      data,
      ...(args.seriesColumns.length ? { seriesColumns: args.seriesColumns.map(columnIndex) } : {}),
      anchor: { sheetId: anchor.sheetId ?? 0, rowIndex: anchor.startRowIndex, columnIndex: anchor.startColumnIndex },
      title: args.title,
      headers: args.headers,
    }),
  ]);
  return { chartId: reply.replies?.[0]?.addChart?.chart?.chartId ?? null, type: args.type, dataRange: args.dataRange, anchorCell: args.anchorCell };
};
