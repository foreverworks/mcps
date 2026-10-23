import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";

import { consentSummary } from "../domain/consent.js";
import { consentValidUntil } from "../domain/dates.js";
import { startAuthArgs } from "./startAuthArgs.js";

/**
 * The line a user confirms before a consent is started (MCP_CONFIRM=elicit):
 * the bank, its country, the PSU type and the end date that will be requested.
 * The arguments are parsed with the tool's own schema, so its defaults apply
 * here exactly as they will in the call, and the line comes from the same
 * domain rules. The date is computed when the user is asked, and the call
 * computes it again when it runs, so a confirmation given later moves it by
 * that delay, which the line says. `nowMs` is the clock the line reads; a test
 * pins it.
 */
export const startAuthSummary = (nowMs: () => number = Date.now) =>
  summaryFrom(startAuthArgs, (args) =>
    consentSummary({
      aspspName: args.aspsp_name,
      aspspCountry: args.aspsp_country,
      psuType: args.psu_type,
      validUntil: consentValidUntil(nowMs()),
    }),
  );

/**
 * Every tool this server registers, and what it may do (packages/mcp-kit,
 * policy.ts). Reading a statement or the bank catalogue is `read`. Storing a
 * consent is `write`: it changes sessions.json, but it only completes what a
 * confirmed start_auth began and the bank's SCA let through. Ending one is
 * `write` too: it takes access away and moves no money, and the account holder
 * can grant it again. Writing an export is `read`: the file lands in this
 * server's own exports folder and nothing changes anywhere else. Starting a consent
 * is `money`: it asks a bank to grant access to the account holder's accounts
 * for months, so the client asks the user to approve each call.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  list_aspsps: { access: "read" },
  list_stored_sessions: { access: "read" },
  list_accounts: { access: "read" },
  get_transactions: { access: "read" },
  get_balances: { access: "read" },
  export_transactions: { access: "read" },
  complete_auth: { access: "write" },
  revoke_session: { access: "write" },
  start_auth: { access: "money", summary: startAuthSummary() },
};
