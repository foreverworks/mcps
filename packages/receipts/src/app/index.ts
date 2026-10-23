/**
 * The use cases every delivery-app receipts server shares, and the ports they
 * are written against. A server supplies its app (receiptApp.ts) and gets
 * get_receipts, search_items, export_items, match_card_charges and
 * order_stats back.
 */
export { fetchOne, unreadable, type Failures, type Fetched } from "./fetched.js";
export type { BaseDeps, CredentialsFile, FilePort, OrderStore, Paths, Written } from "./ports.js";
export type { CardMatching, Detail, ExportDeps, ItemRow, ReceiptApp, ReceiptFilter } from "./receiptApp.js";
export {
  makeReceiptUseCases,
  type ChargeInput,
  type ItemsInput,
  type MatchInput,
  type ReceiptsInput,
  type ReceiptUseCases,
  type SearchInput,
  type StatsInput,
} from "./usecases.js";
