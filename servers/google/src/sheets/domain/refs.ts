import { type ApiRequest, type Discovery, rewriteTyped } from "../../editors/domain/discovery.js";
import { gridRange, parseA1 } from "./a1.js";
import { asAppError, fail, inputError } from "./errors.js";

/**
 * A1 where the API wants coordinates. Sheets' requests name cells by sheet id
 * and 0-based, end-exclusive indices, the arithmetic a model gets wrong most;
 * wherever the schema puts a GridRange, a GridCoordinate or a DimensionRange,
 * batch_update_spreadsheet also takes the A1 a person would write, which must
 * name its sheet. Pure.
 *
 *   GridRange       "Sheet1!A1:C10", "Sheet1!B:B", "Sheet1!2:2", or "Sheet1" for the whole sheet
 *   GridCoordinate  "Sheet1!B3"
 *   DimensionRange  "Sheet1!3:5" (rows 3 to 5) or "Sheet1!B:D" (columns B to D)
 */

const A1_TYPES = new Set(["GridRange", "GridCoordinate", "DimensionRange"]);

/** Whether any request gives one of those types as A1, so the sheet ids must be read first. */
export const hasA1 = (api: Discovery, requests: readonly ApiRequest[]): boolean => {
  let found = false;
  rewriteTyped(api, requests, (type, value) => {
    if (A1_TYPES.has(type) && typeof value === "string") found = true;
    return undefined;
  });
  return found;
};

const converter = (sheets: ReadonlyMap<string, number>) => {
  const names = [...sheets.keys()];
  return (type: string, text: string): Readonly<Record<string, unknown>> | string => {
    let a1: ReturnType<typeof parseA1>;
    try {
      a1 = parseA1(text, names);
    } catch (thrown) {
      const error = asAppError(thrown);
      if (!error) throw thrown;
      return error.message;
    }
    if (a1.sheet === undefined) return `"${text}" names no sheet; write it as Sheet1!${text}`;
    const sheetId = sheets.get(a1.sheet);
    if (sheetId === undefined) {
      return `no sheet "${a1.sheet}" (sheets: ${names.join(", ")}); a sheet this batch adds is named by the sheetId given in its addSheet`;
    }
    if (type === "GridRange") return { ...gridRange(a1, sheetId) };
    if (type === "GridCoordinate") {
      const single = a1.startRow !== undefined && a1.startColumn !== undefined && a1.endRow === a1.startRow + 1 && a1.endColumn === a1.startColumn + 1;
      return single ? { sheetId, rowIndex: a1.startRow, columnIndex: a1.startColumn } : `"${text}" is not one cell, which a GridCoordinate is`;
    }
    const rows = a1.startRow !== undefined && a1.startColumn === undefined && a1.endColumn === undefined;
    const columns = a1.startColumn !== undefined && a1.startRow === undefined && a1.endRow === undefined;
    if (rows) return { sheetId, dimension: "ROWS", startIndex: a1.startRow, endIndex: a1.endRow };
    if (columns) return { sheetId, dimension: "COLUMNS", startIndex: a1.startColumn, endIndex: a1.endColumn };
    return `"${text}" is neither whole rows ("Sheet1!3:5") nor whole columns ("Sheet1!B:D"), which a DimensionRange is`;
  };
};

/**
 * The requests with every A1 string replaced by the coordinates it names, or
 * a refusal listing each that does not resolve. `sheets` maps title to id.
 */
export const resolveA1 = (api: Discovery, requests: readonly ApiRequest[], sheets: ReadonlyMap<string, number>): readonly ApiRequest[] => {
  const convert = converter(sheets);
  const problems: string[] = [];
  const resolved = rewriteTyped(api, requests, (type, value, path) => {
    if (!A1_TYPES.has(type) || typeof value !== "string") return undefined;
    const answer = convert(type, value);
    if (typeof answer === "string") {
      problems.push(`${path}: ${answer}`);
      return value;
    }
    return answer;
  });
  if (problems.length > 0) return fail(inputError(`${problems.length === 1 ? "an A1 range does" : "A1 ranges do"} not resolve; nothing was sent: ${problems.slice(0, 20).join("; ")}`));
  return resolved;
};
