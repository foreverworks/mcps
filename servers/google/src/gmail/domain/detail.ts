/** How much of a message the caller wants back. */
export const DETAILS = ["metadata", "text", "raw_html"] as const;

export type Detail = (typeof DETAILS)[number];

/**
 * A model that invents a level gets the useful default rather than an error.
 * Being strict here would turn a typo into a failed tool call for no gain.
 */
export const parseDetail = (value: string | undefined): Detail =>
  (DETAILS as readonly string[]).includes(value ?? "") ? (value as Detail) : "text";
