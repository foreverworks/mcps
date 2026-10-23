import { fileIdFrom } from "../../../editors/domain/ids.js";
import { type Plan, planAppend, planUpsert, type RowInput } from "../../domain/rows.js";
import type { Deps } from "../ports.js";
import { readTable } from "./read.js";

export type RowsResult = { readonly sheet: string; readonly updatedRows: readonly number[]; readonly appendedRows: readonly number[] };

const apply = async (deps: Deps, spreadsheetId: string, sheet: string, plan: Plan): Promise<RowsResult> => {
  if (plan.requests.length > 0) await deps.sheets.batchUpdate(spreadsheetId, plan.requests);
  return { sheet, updatedRows: plan.updated, appendedRows: plan.appended };
};

/** Rows after the last one holding anything, keyed by the header. One read, one atomic batch. */
export const appendRows = async (
  deps: Deps,
  args: { readonly spreadsheetId: string; readonly sheet: string; readonly headerRow: number; readonly rows: readonly RowInput[] },
): Promise<RowsResult> => {
  const id = fileIdFrom(args.spreadsheetId);
  const table = await readTable(deps, id, args.sheet, args.headerRow);
  return apply(deps, id, table.sheet, planAppend(table, args.rows));
};

/** Update the rows whose key matches, append the rest. One read, one atomic batch. */
export const upsertRows = async (
  deps: Deps,
  args: { readonly spreadsheetId: string; readonly sheet: string; readonly headerRow: number; readonly key: string; readonly rows: readonly RowInput[] },
): Promise<RowsResult> => {
  const id = fileIdFrom(args.spreadsheetId);
  const table = await readTable(deps, id, args.sheet, args.headerRow);
  return apply(deps, id, table.sheet, planUpsert(table, args.key, args.rows));
};
