import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: health, the reviews, TestFlight feedback and a crash log (saved to
 *   the server's outbox, nothing in the store changes).
 * - write: a reply to a review. It is public, under the developer's name, and
 *   no money moves. Each sets the review's one reply, and the same text again
 *   sends nothing, so both are idempotent (a test calls each twice).
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  list_app_store_reviews: { access: "read" },
  list_play_reviews: { access: "read" },
  list_testflight_feedback: { access: "read" },
  get_testflight_crash_log: { access: "read" },
  reply_app_store_review: { access: "write", idempotent: true },
  reply_play_review: { access: "write", idempotent: true },
};
