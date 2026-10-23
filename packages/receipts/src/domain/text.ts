/**
 * Whether `text` contains `query`, ignoring case: the one way every filter here
 * matches a restaurant, a store or a product name. No query matches everything;
 * absent text matches only an empty query.
 */
export const containsIgnoringCase = (text: string | undefined, query: string | undefined): boolean =>
  query === undefined || (text ?? "").toLowerCase().includes(query.toLowerCase());
