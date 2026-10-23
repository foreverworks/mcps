import { fail, inputError } from "./errors.js";
import type { GridRangeOut } from "./schema.js";

/**
 * A1 notation, both ways. Pure. Rows and columns here are 0-based and ends are
 * exclusive, as in Google's GridRange; A1 is 1-based and inclusive.
 */

/** A sheet title as A1 needs it: always quoted, quotes doubled, so a title with spaces or a "!" is safe. */
export const quoteSheet = (title: string): string => `'${title.replace(/'/g, "''")}'`;

export const columnLetter = (index: number): string => {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

export const columnIndex = (letters: string): number =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** A range as parsed: every bound is optional, because "B:D", "2:5" and a bare sheet name are all ranges. */
export type A1 = {
  readonly sheet?: string;
  readonly startRow?: number;
  readonly endRow?: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
};

const CELL = /^([A-Za-z]{0,3})(\d*)$/;

const splitSheet = (range: string): { readonly sheet?: string; readonly cells: string } => {
  const at = range.lastIndexOf("!");
  if (at === -1) return { cells: range.trim() };
  const raw = range.slice(0, at).trim();
  const sheet = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
  return { sheet, cells: range.slice(at + 1).trim() };
};

/**
 * "Sheet1!A1:C10", "'My sheet'!B:D", "A2", "2:5", or a sheet name alone.
 * Anything else is refused before a request is built: a range that means
 * something other than what was meant writes to the wrong cells.
 */
export const parseA1 = (range: string, sheetNames: readonly string[] = []): A1 => {
  const { sheet, cells } = splitSheet(range);
  if (!cells || (sheet === undefined && sheetNames.includes(cells))) return sheet === undefined ? { sheet: cells } : { sheet };
  const [from = "", to = from, extra] = cells.split(":");
  const a = CELL.exec(from);
  const b = CELL.exec(to);
  if (extra !== undefined || !a || !b || (!a[1] && !a[2]) || (!b[1] && !b[2])) return fail(inputError(`"${range}" is not an A1 range`));
  const bound = (letters: string | undefined, digits: string | undefined) => ({
    column: letters ? columnIndex(letters) : undefined,
    row: digits ? Number(digits) - 1 : undefined,
  });
  const start = bound(a[1], a[2]);
  const end = bound(b[1], b[2]);
  return {
    ...(sheet === undefined ? {} : { sheet }),
    ...(start.row === undefined ? {} : { startRow: start.row }),
    ...(end.row === undefined ? {} : { endRow: end.row + 1 }),
    ...(start.column === undefined ? {} : { startColumn: start.column }),
    ...(end.column === undefined ? {} : { endColumn: end.column + 1 }),
  };
};

export const gridRange = (a1: A1, sheetId: number): GridRangeOut => ({
  sheetId,
  ...(a1.startRow === undefined ? {} : { startRowIndex: a1.startRow }),
  ...(a1.endRow === undefined ? {} : { endRowIndex: a1.endRow }),
  ...(a1.startColumn === undefined ? {} : { startColumnIndex: a1.startColumn }),
  ...(a1.endColumn === undefined ? {} : { endColumnIndex: a1.endColumn }),
});
