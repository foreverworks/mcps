import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: the listings, a filing's file, the status, health. They change nothing.
 * - write: the login tools change what the service holds (a begun login, the
 *   session, or none); no money, no document. The filings themselves
 *   (a mențiune, a capital increase) are not offered yet: when they are, their
 *   submission is `money` (a legal act with a fee), with a summary line a
 *   client confirms with the user.
 */
export const policy: ToolPolicy = {
  health: { access: "read" },
  session_status: { access: "read" },
  begin_login: { access: "write" },
  complete_login: { access: "write" },
  logout: { access: "write" },
  list_requests: { access: "read" },
  get_request: { access: "read" },
  list_calculation_notes: { access: "read" },
  list_invoices: { access: "read" },
};
