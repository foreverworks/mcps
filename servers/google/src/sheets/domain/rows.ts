import { type CellValue, cellToWrite, keyText, type WritableValue } from "./cells.js";
import { ambiguousError, fail, inputError } from "./errors.js";
import type { CellDataOut, SheetsRequest } from "./schema.js";
import { ROW_KEY, type Table } from "./table.js";

/**
 * Rows to write, as ONE list of structural requests, planned against one read
 * of the sheet. Pure.
 *
 * One spreadsheets.batchUpdate is atomic: every request applies or none does,
 * so an upsert never leaves half its rows written. Rows go to explicit
 * positions, which is what lets each cell set only what it must (a value keeps
 * the cell's format; a date also sets a date format).
 */

export type RowInput = Readonly<Record<string, WritableValue>>;

export type Plan = {
  readonly requests: readonly SheetsRequest[];
  /** Sheet row numbers (1-based) that were updated, and those that were added. */
  readonly updated: readonly number[];
  readonly appended: readonly number[];
};

/** Keys the header does not have are refused: a typo must not vanish, and a new column is a decision. */
const checkKeys = (table: Table, rows: readonly RowInput[]): void => {
  const unknown = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== ROW_KEY && !table.keys.includes(k));
  if (unknown.length > 0) {
    fail(inputError(`no column named ${unknown.map((k) => `"${k}"`).join(", ")} in "${table.sheet}" (columns: ${table.keys.join(", ")})`));
  }
};

/**
 * One row's cells as updateCells requests: consecutive columns that set the
 * same fields share one request, so a typical row is one request, not one per cell.
 */
const rowRequests = (table: Table, rowIndex: number, row: RowInput): readonly SheetsRequest[] => {
  const cells = table.keys
    .map((key, column) => ({ column, given: Object.hasOwn(row, key), value: row[key] ?? null }))
    .filter((c) => c.given)
    .map((c) => ({ column: c.column, ...cellToWrite(c.value) }));
  const runs = cells.reduce<{ column: number; fields: string; cells: CellDataOut[] }[]>((acc, c) => {
    const last = acc[acc.length - 1];
    if (last && last.fields === c.fields && last.column + last.cells.length === c.column) {
      return [...acc.slice(0, -1), { ...last, cells: [...last.cells, c.cell] }];
    }
    return [...acc, { column: c.column, fields: c.fields, cells: [c.cell] }];
  }, []);
  return runs.map((run) => ({
    updateCells: {
      start: { sheetId: table.sheetId, rowIndex, columnIndex: run.column },
      rows: [{ values: run.cells }],
      fields: run.fields,
    },
  }));
};

/**
 * New rows after the last one holding anything. The grid grows first when it
 * is full, and the new rows take the last data row's formatting (as a row
 * inserted by hand would), so an amount lands in a currency cell.
 */
const appendRequests = (table: Table, rows: readonly RowInput[]): { readonly requests: readonly SheetsRequest[]; readonly at: number } => {
  const at = table.extent;
  const grow = at + rows.length - table.rowCount;
  const width = table.keys.length;
  const hasDataAbove = at > table.headerRow + 1;
  return {
    at,
    requests: [
      ...(grow > 0 ? [{ appendDimension: { sheetId: table.sheetId, dimension: "ROWS", length: grow } }] : []),
      ...(hasDataAbove && rows.length > 0
        ? [
            {
              copyPaste: {
                source: { sheetId: table.sheetId, startRowIndex: at - 1, endRowIndex: at, startColumnIndex: 0, endColumnIndex: width },
                destination: { sheetId: table.sheetId, startRowIndex: at, endRowIndex: at + rows.length, startColumnIndex: 0, endColumnIndex: width },
                pasteType: "PASTE_FORMAT",
              },
            },
          ]
        : []),
      ...rows.flatMap((row, i) => rowRequests(table, at + i, row)),
    ],
  };
};

export const planAppend = (table: Table, rows: readonly RowInput[]): Plan => {
  checkKeys(table, rows);
  const { requests, at } = appendRequests(table, rows);
  return { requests, updated: [], appended: rows.map((_, i) => at + i + 1) };
};

/**
 * Update the rows whose `key` column matches, append the rest, in one batch.
 *
 * Keys compare as the typed values print (1001 matches "1001", a date matches
 * its ISO string). A key two sheet rows share is ambiguous and refused before
 * anything is written; so is an input row with no key, or two input rows with
 * the same one.
 */
export const planUpsert = (table: Table, key: string, rows: readonly RowInput[]): Plan => {
  checkKeys(table, rows);
  const column = table.keys.indexOf(key);
  if (column === -1) return fail(inputError(`no column named "${key}" in "${table.sheet}" (columns: ${table.keys.join(", ")})`));

  const wanted = rows.map((row) => keyText(row[key] ?? null));
  if (wanted.some((k) => k === "")) return fail(inputError(`every row needs a value for the key column "${key}"`));
  const repeated = wanted.filter((k, i) => wanted.indexOf(k) !== i);
  if (repeated.length > 0) return fail(inputError(`key ${repeated.map((k) => `"${k}"`).join(", ")} appears twice in the rows given`));

  const where = new Map<string, number[]>();
  for (const row of table.rows) {
    const k = keyText(row.values[column] as CellValue);
    if (k) where.set(k, [...(where.get(k) ?? []), row.index]);
  }
  const shared = wanted.filter((k) => (where.get(k)?.length ?? 0) > 1);
  if (shared.length > 0) {
    return fail(ambiguousError(`key "${shared[0]}" is on more than one row of "${table.sheet}"`, (where.get(shared[0] as string) ?? []).map((i) => `row ${i + 1}`)));
  }

  // A matched row's key cell is left as it is: it already matches, and rewriting it in the caller's
  // spelling could turn the number 1002 into the text "1002".
  const updates = rows.flatMap((row, i) => {
    const index = where.get(wanted[i] as string)?.[0];
    const { [key]: _, ...rest } = row;
    return index === undefined ? [] : [{ index, row: rest }];
  });
  const fresh = rows.filter((_, i) => !where.has(wanted[i] as string));
  const appended = appendRequests(table, fresh);
  return {
    requests: [...updates.flatMap((u) => rowRequests(table, u.index, u.row)), ...appended.requests],
    updated: updates.map((u) => u.index + 1),
    appended: fresh.map((_, i) => appended.at + i + 1),
  };
};
