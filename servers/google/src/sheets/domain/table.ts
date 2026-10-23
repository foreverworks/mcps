import { columnLetter } from "./a1.js";
import { type CellValue, shownText, typedValue } from "./cells.js";
import { fail, inputError, required } from "./errors.js";
import type { RawGridData, RawSheetProperties } from "./schema.js";

/** One sheet read as a table: a header row naming the columns, and the rows under it. */
export type Table = {
  readonly sheet: string;
  readonly sheetId: number;
  /** 0-based, like every index here. */
  readonly headerRow: number;
  /** One key per column, from the header row. */
  readonly keys: readonly string[];
  /** The rows under the header that hold anything, each with its 0-based index in the sheet. */
  readonly rows: readonly { readonly index: number; readonly values: readonly CellValue[] }[];
  /** One past the last row holding any value: where a new row goes. */
  readonly extent: number;
  /** How many rows the grid has; writing past it needs rows added first. */
  readonly rowCount: number;
};

/** The key read_rows puts the sheet row number under (1-based, as A1 counts). */
export const ROW_KEY = "_row";

/**
 * Column keys from the header row's text. An empty header becomes the column's
 * letter and a repeated one gets a suffix, so every key is unique and none is
 * silently dropped. The header ends at its last non-empty cell.
 */
export const headerKeys = (header: readonly string[]): readonly string[] => {
  const width = header.reduce((last, text, i) => (text ? i + 1 : last), 0);
  return header.slice(0, width).reduce<readonly string[]>((keys, text, i) => {
    const base = text || columnLetter(i);
    const taken = (k: string) => k === ROW_KEY || keys.includes(k);
    let key = base;
    for (let n = 2; taken(key); n += 1) key = `${base}_${n}`;
    return [...keys, key];
  }, []);
};

/**
 * A whole sheet's grid data, starting at row 0, as a table whose header is
 * row `headerRow`. Rows above the header are not data and are left out.
 */
export const tableOf = (properties: RawSheetProperties, data: RawGridData | undefined, headerRow: number): Table => {
  const rows = data?.rowData ?? [];
  const keys = headerKeys((rows[headerRow]?.values ?? []).map(shownText));
  if (keys.length === 0) return fail(inputError(`row ${headerRow + 1} of "${properties.title}" is empty, so it cannot name the columns; pass header_row`));
  const typed = rows
    .map((row, index) => ({ index, values: keys.map((_, c) => typedValue(row.values?.[c])) }))
    .filter((row) => row.index > headerRow && row.values.some((v) => v !== null));
  const last = rows.reduce((end, row, index) => ((row.values ?? []).some((c) => c.effectiveValue) ? index + 1 : end), headerRow + 1);
  return {
    sheet: required(properties.title, "sheet title"),
    sheetId: required(properties.sheetId, "sheetId"),
    headerRow,
    keys,
    rows: typed,
    extent: Math.max(last, headerRow + 1),
    rowCount: properties.gridProperties?.rowCount ?? rows.length,
  };
};

/** One row as an object keyed by the header, with its sheet row number. */
export const rowObject = (keys: readonly string[], row: Table["rows"][number]): Readonly<Record<string, CellValue>> =>
  Object.fromEntries([[ROW_KEY, row.index + 1], ...keys.map((k, c) => [k, row.values[c] ?? null])]);
