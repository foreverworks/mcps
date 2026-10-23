import { toCsv } from "../../domain/items.js";
import { parseRange } from "../../domain/range.js";
import type { Fetched } from "../fetched.js";
import type { ExportDeps, ItemRow, ReceiptFilter } from "../receiptApp.js";

export type ItemsInput = { readonly since?: string; readonly until?: string };
export type SearchInput = ItemsInput & { readonly query?: string; readonly top: number };

type Source<D, R, Row, Ranked> = {
  readonly name: string;
  readonly receiptsInRange: (deps: D, filter: ReceiptFilter) => Promise<readonly Fetched<R>[]>;
  readonly itemRows: (receipt: R) => readonly Row[];
  readonly rankItems: (rows: readonly Row[], query: string | undefined, top: number) => Ranked;
};

/**
 * Every line item in range. Unbounded on purpose: this is the "whole history"
 * question, and after the first run it is answered from the store.
 */
const rowsInRange = async <D, R, Row>(app: Source<D, R, Row, unknown>, deps: D, input: ItemsInput) => {
  const fetched = await app.receiptsInRange(deps, parseRange(input.since, input.until));
  return {
    rows: fetched.flatMap((f) => (f.ok ? app.itemRows(f.receipt) : [])),
    orders: fetched.length,
    unreadable: fetched.filter((f) => !f.ok).length,
  };
};

export const searchItems = async <D, R, Row, Ranked>(app: Source<D, R, Row, Ranked>, deps: D, input: SearchInput) => {
  const { rows, orders, unreadable } = await rowsInRange(app, deps, input);
  return { ordersScanned: orders, unreadableOrders: unreadable, items: app.rankItems(rows, input.query, input.top) };
};

export const exportItems = async <D extends ExportDeps, R, Row extends ItemRow>(app: Source<D, R, Row, unknown>, deps: D, input: ItemsInput) => {
  const { rows, orders, unreadable } = await rowsInRange(app, deps, input);
  // Named for the range AND the moment, so a second export never replaces a file someone is reading.
  const at = new Date(deps.now()).toISOString().replace(/[:.]/g, "-");
  const name = `${app.name}-items-${input.since ?? "start"}-${input.until ?? "latest"}-${at}.csv`;
  const written = await deps.files.writeText(deps.paths.exportsDir, name, toCsv(rows));
  return { ...written, orders, lineItems: rows.length, unreadableOrders: unreadable };
};
