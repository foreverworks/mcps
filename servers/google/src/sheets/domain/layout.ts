import { fail, inputError } from "./errors.js";
import type { SheetsRequest } from "./schema.js";

export type SheetSpec = { readonly title: string; readonly headers: readonly string[] };

/** A new grid's default width; a header row wider than it widens the sheet. */
const DEFAULT_COLUMNS = 26;

/**
 * A new spreadsheet's sheets as one batch: the sheet Drive made is renamed to
 * the first, the rest are added, and each gets its header row in bold with
 * the row frozen. The added sheets get ids chosen here, above the existing
 * one, so their headers can be written in the same batch.
 */
export const layoutRequests = (existingSheetId: number, specs: readonly SheetSpec[]): readonly SheetsRequest[] => {
  const titles = specs.map((s) => s.title);
  const twice = titles.filter((t, i) => titles.indexOf(t) !== i);
  if (twice.length > 0) return fail(inputError(`sheet title "${twice[0]}" is given twice`));
  return specs.flatMap((spec, i): readonly SheetsRequest[] => {
    const sheetId = existingSheetId + i;
    const gridProperties = {
      frozenRowCount: spec.headers.length > 0 ? 1 : 0,
      columnCount: Math.max(DEFAULT_COLUMNS, spec.headers.length),
    };
    const sheet: SheetsRequest =
      i === 0
        ? { updateSheetProperties: { properties: { sheetId, title: spec.title, gridProperties }, fields: "title,gridProperties.frozenRowCount,gridProperties.columnCount" } }
        : { addSheet: { properties: { sheetId, title: spec.title, index: i, gridProperties } } };
    const header: readonly SheetsRequest[] =
      spec.headers.length === 0
        ? []
        : [
            {
              updateCells: {
                start: { sheetId, rowIndex: 0, columnIndex: 0 },
                rows: [{ values: spec.headers.map((h) => ({ userEnteredValue: { stringValue: h }, userEnteredFormat: { textFormat: { bold: true } } })) }],
                fields: "userEnteredValue,userEnteredFormat.textFormat.bold",
              },
            },
          ];
    return [sheet, ...header];
  });
};
