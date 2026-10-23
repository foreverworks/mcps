import type { SourceQuery } from "../../domain/query.js";

/**
 * The search as RSQL, the `query` of GET /trademarks (spec 1.1.0, "Supported
 * Fields"). The verbal element supports only `==` and `!=`, with `*` as a
 * wildcard and no fuzzy or phonetic form, so `word` and `similar` are both
 * "contains" here. The spec does not say whether `==` ignores case, so every
 * comparison is asked in the name's own, upper, lower and title case: right
 * either way, at the cost of a longer query.
 */
const VERBAL = "wordMarkSpecification.verbalElement";

/** What ends a bare RSQL value (the grammar's `reserved`, and a space). */
const NEEDS_QUOTES = /["'();,=!~<>\s]/;

const value = (v: string): string => (NEEDS_QUOTES.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v);

const titled = (s: string): string => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());

const casings = (name: string): readonly string[] => [...new Set([name, name.toUpperCase(), name.toLowerCase(), titled(name)])];

/** Dead in EUIPO's words; everything else can still stand in a new name's way, including statuses added later. */
export const DEAD_STATUSES = ["WITHDRAWN", "REFUSED", "CANCELLED", "SURRENDERED", "EXPIRED", "REMOVED_FROM_REGISTER"] as const;

export const rsqlOf = (query: SourceQuery): string => {
  const name = query.name.trim();
  const pattern = (v: string) => (query.match === "exact" ? v : `*${v}*`);
  const text = `(${casings(name)
    .map((v) => `${VERBAL}==${value(pattern(v))}`)
    .join(" or ")})`;
  return [
    text,
    ...(query.classes.length > 0 ? [`niceClasses=in=(${query.classes.join(",")})`] : []),
    ...(query.status === "live" ? [`status=out=(${DEAD_STATUSES.join(",")})`] : []),
  ].join(" and ");
};
