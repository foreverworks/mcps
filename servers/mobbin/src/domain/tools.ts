import type { ToolSpec } from "./schema.js";

/**
 * The upstream tools this server has classified, and so may expose. Each reads
 * Mobbin's library and changes nothing. A tool Mobbin adds is not here, so it
 * is not offered, until someone reads it and decides what it is
 * (mcp/policy.ts builds the policy from this list).
 */
export const KNOWN_TOOLS = ["search_screens", "search_flows", "search_sections"] as const;

export type TourOfTools = {
  /** Listed upstream and classified here: callable. */
  readonly exposed: readonly string[];
  /** Listed upstream, not classified: hidden, until the code says what they are. */
  readonly hidden: readonly string[];
  /** Classified here, not listed upstream (renamed, retired or not offered to this account). */
  readonly missing: readonly string[];
};

/** How the upstream's list and this server's classification compare. */
export const tourOf = (listed: readonly Pick<ToolSpec, "name">[], known: readonly string[] = KNOWN_TOOLS): TourOfTools => {
  const names = listed.map((t) => t.name);
  return {
    exposed: names.filter((n) => known.includes(n)).sort(),
    hidden: names.filter((n) => !known.includes(n)).sort(),
    missing: known.filter((n) => !names.includes(n)).sort(),
  };
};
