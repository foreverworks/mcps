import { csvOf } from "@foreverworks/mcp-kit";

import { formatMinor } from "./money.js";
import { DELIVERED, REMOVED } from "./receipt.js";
import { containsIgnoringCase } from "./text.js";

/**
 * Product lines across orders: the ranking behind search_items and the CSV
 * behind export_items. Each app flattens its own receipt into its own row (its
 * columns are the CSV's); what is shared is how rows are counted and written.
 */

/** What ranking reads from an app's item row. */
export type RankableRow = {
  readonly state: string;
  /** "" when the line was not adjusted. */
  readonly adjustment: string;
  readonly localDate: string;
  readonly item: string | undefined;
};

export type RankSpec<Row, Name, Latest> = {
  /** The fields a product is known by, e.g. `{ item, provider }`. Rows naming the same product are one group. */
  readonly name: (row: Row) => Name;
  readonly qty: (row: Row) => number;
  /** What the line adds to `spent`, in minor units: 0 for a line with no usable price. */
  readonly spentMinor: (row: Row) => number;
  /** The fields that follow the most recent order, e.g. `{ lastUnitPrice }`. */
  readonly latest: (row: Row) => Latest;
};

type Group<Name, Latest> = {
  readonly name: Name;
  readonly times: number;
  readonly qty: number;
  readonly spentMinor: number;
  readonly first: string;
  readonly last: string;
  readonly latest: Latest;
};

/**
 * Every product, grouped by its name fields, most-ordered first, then by spend.
 *
 * Only delivered orders count, and a line a picker removed does not: it was
 * never paid for, so counting it would overstate both frequency and spend.
 */
export const rankItemsBy =
  <Row extends RankableRow, Name extends object, Latest extends object>(spec: RankSpec<Row, Name, Latest>) =>
  (rows: readonly Row[], query: string | undefined, top: number) => {
    const start = (row: Row): Group<Name, Latest> => ({
      name: spec.name(row),
      times: 1,
      qty: spec.qty(row),
      spentMinor: spec.spentMinor(row),
      first: row.localDate,
      last: row.localDate,
      latest: spec.latest(row),
    });
    const add = (g: Group<Name, Latest>, row: Row): Group<Name, Latest> => ({
      ...g,
      times: g.times + 1,
      qty: g.qty + spec.qty(row),
      spentMinor: g.spentMinor + spec.spentMinor(row),
      first: row.localDate < g.first ? row.localDate : g.first,
      ...(row.localDate >= g.last ? { last: row.localDate, latest: spec.latest(row) } : {}),
    });

    const groups = new Map<string, Group<Name, Latest>>();
    for (const row of rows) {
      if (row.state !== DELIVERED || row.adjustment === REMOVED || !containsIgnoringCase(row.item, query)) continue;
      const key = JSON.stringify(spec.name(row));
      const known = groups.get(key);
      groups.set(key, known ? add(known, row) : start(row));
    }

    return [...groups.values()]
      .sort((a, b) => b.times - a.times || b.spentMinor - a.spentMinor)
      .slice(0, top)
      .map((g) => ({ ...g.name, times: g.times, qty: g.qty, first: g.first, last: g.last, ...g.latest, spent: formatMinor(g.spentMinor) }));
  };

/** One header line from the first row's keys, then one line per row (the kit's csvOf). Empty for no rows. */
export const toCsv = <Row extends Readonly<Record<string, unknown>>>(rows: readonly Row[]): string => {
  const first = rows[0];
  return first ? csvOf(Object.keys(first), rows) : "";
};
