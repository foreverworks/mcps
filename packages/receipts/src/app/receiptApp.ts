import type { RankableRow } from "../domain/items.js";
import type { Dated } from "../domain/matching.js";
import type { DateRange } from "../domain/range.js";
import type { ReceiptCore } from "../domain/receipt.js";
import type { Fetched } from "./fetched.js";
import type { FilePort, Paths } from "./ports.js";

/**
 * What a delivery app's server hands the shared use cases: how to find its
 * receipts, and how to read the ones it found. Everything else about a receipt
 * (its fields, its wording) stays the app's.
 */

/** Which orders a caller wants: a range of local dates, and optionally one state. */
export type ReceiptFilter = DateRange & { readonly state?: string };

/** 'headline' = the receipt without its lines; 'full' = the whole receipt. */
export type Detail = "full" | "headline";

/** The only deps the shared use cases touch themselves: where exports go, what writes them, and the clock that names them. */
export type ExportDeps = { readonly files: FilePort; readonly paths: Pick<Paths, "exportsDir">; readonly now: () => number };

export type CardMatching<R, W> = {
  /**
   * Which receipts to read for card rows booked in [since, until], the window
   * already applied. bolt-food asks for delivered orders placed in it; glovo
   * walks a day wider on each side, because its walk is by local date and its
   * window by UTC date.
   */
  readonly filter: (since: string, until: string) => ReceiptFilter;
  /** When the order happened, as far as a card row is concerned; undefined when it cannot be dated. */
  readonly dated: (receipt: R) => Dated | undefined;
  /** How the result names the dates it searched, e.g. `{ orderDatesSearched: { since, until } }`. */
  readonly searched: (since: string, until: string) => W;
};

/** An item row: rankable, and flat enough for a CSV line (its keys are the columns). */
export type ItemRow = RankableRow & Readonly<Record<string, unknown>>;

export type ReceiptApp<D, R extends ReceiptCore, H, Row extends ItemRow, Ranked, W> = {
  /** The server's name. Export files are `<name>-items-<since>-<until>-<written at>.csv`. */
  readonly name: string;
  /**
   * Receipts for the orders dated in the filter's range (and in its state, when
   * it names one), newest first, with an order that could not be read reported
   * in place rather than thrown.
   */
  readonly receiptsInRange: (deps: D, filter: ReceiptFilter) => Promise<readonly Fetched<R>[]>;
  readonly headline: (receipt: R) => H;
  /** One flat row per product line; its keys are the CSV's columns. */
  readonly itemRows: (receipt: R) => readonly Row[];
  readonly rankItems: (rows: readonly Row[], query: string | undefined, top: number) => Ranked;
  /** The store or restaurant an order came from, as order_stats groups it; undefined when the app gave none. */
  readonly storeOf: (receipt: R) => string | undefined;
  readonly matching: CardMatching<R, W>;
};
