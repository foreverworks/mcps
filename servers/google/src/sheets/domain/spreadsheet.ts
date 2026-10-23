import { notFoundError, fail, required } from "./errors.js";
import type { RawSheetProperties, RawSpreadsheet } from "./schema.js";

export const sheetLink = (spreadsheetId: string): string => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

/** The sheet a caller named, or the first one when none was named. */
export const pickSheet = (raw: RawSpreadsheet, name: string): RawSheetProperties => {
  const sheets = (raw.sheets ?? []).flatMap((s) => (s.properties ? [s.properties] : []));
  const found = name ? sheets.find((s) => s.title === name) ?? sheets.find((s) => s.title?.toLowerCase() === name.toLowerCase()) : sheets[0];
  return found ?? fail(notFoundError(`no sheet "${name}" (sheets: ${sheets.map((s) => s.title).join(", ") || "none"})`));
};

export type SheetSummary = {
  readonly sheetId: number;
  readonly title: string;
  readonly index: number;
  readonly rows: number | null;
  readonly columns: number | null;
  readonly frozenRows: number;
  readonly hidden: boolean;
};

export const sheetSummary = (p: RawSheetProperties): SheetSummary => ({
  sheetId: required(p.sheetId, "sheetId"),
  title: required(p.title, "sheet title"),
  index: p.index ?? 0,
  // A sheet that is not a grid (an object sheet holding one chart) has no rows or columns.
  rows: p.gridProperties?.rowCount ?? null,
  columns: p.gridProperties?.columnCount ?? null,
  frozenRows: p.gridProperties?.frozenRowCount ?? 0,
  hidden: p.hidden ?? false,
});
