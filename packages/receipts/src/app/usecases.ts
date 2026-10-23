import type { ReceiptCore } from "../domain/receipt.js";
import type { ExportDeps, ItemRow, ReceiptApp } from "./receiptApp.js";
import { exportItems, type ItemsInput, searchItems, type SearchInput } from "./usecases/items.js";
import { matchCardCharges, type MatchInput } from "./usecases/matching.js";
import { getReceipts, type ReceiptsInput } from "./usecases/receipts.js";
import { orderStatistics, type StatsInput } from "./usecases/stats.js";

export type { ChargeInput, MatchInput } from "./usecases/matching.js";
export type { ItemsInput, SearchInput } from "./usecases/items.js";
export type { ReceiptsInput } from "./usecases/receipts.js";
export type { StatsInput } from "./usecases/stats.js";

/** The shared tools' use cases, as the mcp layer calls them. */
export type ReceiptUseCases<D> = {
  readonly getReceipts: (deps: D, input: ReceiptsInput) => Promise<unknown>;
  readonly searchItems: (deps: D, input: SearchInput) => Promise<unknown>;
  readonly exportItems: (deps: D, input: ItemsInput) => Promise<unknown>;
  readonly matchCardCharges: (deps: D, input: MatchInput) => Promise<unknown>;
  readonly orderStats: (deps: D, input: StatsInput) => Promise<unknown>;
};

/**
 * The use cases every receipts server has, bound to one app: get_receipts,
 * search_items, export_items, match_card_charges and order_stats. What differs between the
 * apps arrives in `app`; the rules (the range cap, the card-row join, the
 * ranking, the CSV) are written once.
 */
export const makeReceiptUseCases = <D extends ExportDeps, R extends ReceiptCore, H, Row extends ItemRow, Ranked, W extends object>(
  app: ReceiptApp<D, R, H, Row, Ranked, W>,
) => ({
  getReceipts: (deps: D, input: ReceiptsInput) => getReceipts(app, deps, input),
  searchItems: (deps: D, input: SearchInput) => searchItems(app, deps, input),
  exportItems: (deps: D, input: ItemsInput) => exportItems(app, deps, input),
  matchCardCharges: (deps: D, input: MatchInput) => matchCardCharges(app, deps, input),
  orderStats: (deps: D, input: StatsInput) => orderStatistics(app, deps, input),
});
