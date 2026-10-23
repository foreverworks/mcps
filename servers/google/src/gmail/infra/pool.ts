/**
 * How many Gmail requests are in flight at once (packages/mcp-kit's
 * mapWithConcurrency does the mapping).
 *
 * 16 was measured, not guessed: 5 runs of 20 threads, medians were 0.168s at
 * 16, 0.242s at 8, and 0.388s for a single POST to /batch/gmail/v1. The batch
 * endpoint still works and looks like the obvious answer, but Google serialises
 * the sub-requests server-side, so one round trip loses to sixteen concurrent
 * ones. 16 x 10 quota units in flight also sits under Gmail's 250/user/second.
 */
export const DEFAULT_CONCURRENCY = 16;

export { mapWithConcurrency } from "@foreverworks/mcp-kit";
