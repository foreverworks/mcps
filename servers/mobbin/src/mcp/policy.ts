import type { ToolPolicy } from "@foreverworks/mcp-kit";

import { KNOWN_TOOLS } from "../domain/tools.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: health (it never refreshes), and Mobbin's own search tools, which read its
 *   library. The upstream tools are the ones in domain/tools.ts: a tool Mobbin
 *   adds is not offered until it is classified here.
 * - write: the two authorization tools register this server as a client of
 *   Mobbin's sign-in service and replace the grant; refresh_grant rotates it.
 *
 * Nothing here moves money. Mobbin's "deep" search spends the account's AI
 * credits, which is a cost on Mobbin's side and is said in the README.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  refresh_grant: { access: "write" },
  begin_authorization: { access: "write" },
  complete_authorization: { access: "write" },
  ...Object.fromEntries(KNOWN_TOOLS.map((name) => [name, { access: "read" as const }])),
};
