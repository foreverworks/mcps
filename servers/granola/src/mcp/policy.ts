import type { ToolPolicy } from "@foreverworks/mcp-kit";

import { KNOWN_TOOLS } from "../domain/tools.js";

/**
 * Every tool this server registers, classified (packages/mcp-kit, policy.ts).
 *
 * - read: health (it never refreshes), and Granola's own read-only tools, which
 *   read meetings, notes, transcripts and account details. They are the
 *   "forward" ones in domain/tools.ts; the policy is built from that list, so a
 *   tool Granola adds is not offered until someone reads it and classifies it
 *   there. Granola's writes (folders, titles, summaries, private notes, a note
 *   made from a transcript, feedback, sign-out, switch of workspace) are "withhold" in the same
 *   list: they are never registered, so they have no entry here.
 * - write: the two authorization tools register this server as a client of
 *   Granola's sign-in service and replace the grant; refresh_grant rotates it.
 *
 * Nothing here moves money.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  refresh_grant: { access: "write" },
  begin_authorization: { access: "write" },
  complete_authorization: { access: "write" },
  ...Object.fromEntries(KNOWN_TOOLS.map((name) => [name, { access: "read" as const }])),
};
