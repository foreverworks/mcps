import { fileIdFrom } from "../../../editors/domain/ids.js";
import { fail, inputError } from "../../domain/errors.js";
import type { SheetsRequest } from "../../domain/schema.js";
import type { Deps } from "../ports.js";
import { sheetTitle } from "./read.js";

export type CellLink = { readonly row: number; readonly column: number; readonly expectedText: string; readonly url: string };

/** Link literal cells without replacing their values, validation or other formatting. */
export const linkCells = async (deps: Deps, args: { readonly spreadsheetId: string; readonly sheet: string; readonly links: readonly CellLink[] }) => {
  const id = fileIdFrom(args.spreadsheetId);
  const title = await sheetTitle(deps, id, args.sheet);
  const raw = await deps.sheets.grid(id, title);
  const sheet = raw.sheets?.[0];
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId == null) return fail(inputError("sheet has no id"));
  const requests: SheetsRequest[] = [];
  const seen = new Set<string>();
  for (const link of args.links) {
    const key = `${link.row}:${link.column}`;
    if (!Number.isInteger(link.row) || !Number.isInteger(link.column) || link.row < 1 || link.column < 1 || seen.has(key)) {
      return fail(inputError("cell positions must be positive integers without duplicates"));
    }
    seen.add(key);
    if (!/^https?:\/\/\S+$/u.test(link.url)) return fail(inputError("link must be an HTTP or HTTPS URL"));
    const cell = sheet?.data?.[0]?.rowData?.[link.row - 1]?.values?.[link.column - 1];
    if (cell?.userEnteredValue?.stringValue !== link.expectedText || !link.expectedText || cell.textFormatRuns?.length || cell.chipRuns?.length) {
      return fail(inputError(`cell ${key} changed or is not a plain text cell; read it before linking`));
    }
    requests.push({ updateCells: {
      start: { sheetId, rowIndex: link.row - 1, columnIndex: link.column - 1 },
      rows: [{ values: [{ userEnteredFormat: { textFormat: { link: { uri: link.url } } } }] }],
      fields: "userEnteredFormat.textFormat.link",
    } });
  }
  if (requests.length) await deps.sheets.batchUpdate(id, requests);
  return { spreadsheetId: id, sheet: title, linked: requests.length };
};
