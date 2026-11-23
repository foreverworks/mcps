/**
 * How many Gmail requests are in flight at once (packages/mcp-kit's
 * mapWithConcurrency does the mapping).
 *
 * Sixteen concurrent requests beat one POST to /batch/gmail/v1, which looks
 * like the obvious answer: Gmail serves the sub-requests of a batch one after
 * another, so one round trip is slower than sixteen in flight. Sixteen also
 * beat eight in a test of 20 threads, about 0.17 s against 0.24 s.
 * 16 x 10 quota units in flight also sits under Gmail's 250/user/second.
 */
export const DEFAULT_CONCURRENCY = 16;

export { mapWithConcurrency } from "@foreverworks/mcp-kit";
