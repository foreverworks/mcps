#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { runHealthCheck } from "./cli/health.js";
import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * MCP server for Enable Banking's AISP API: read-only access to bank accounts
 * a human has consented to, under PSD2.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout: over
 * stdio it IS the protocol channel, and a stray line there corrupts the session.
 */
const INSTRUCTIONS =
  "Bank accounts through Enable Banking (PSD2), read-only: nothing here moves money. Start with " +
  "list_stored_sessions, which says which consents exist and when each one expires; list_accounts gives the " +
  "account uids. Then get_transactions or get_balances. Each statement or balance read spends one of the few " +
  "reads a bank allows per account per day (about four), so read once and narrow with get_transactions' " +
  "filters, or export_transactions for a long period. A new or renewed consent needs the account holder: " +
  "start_auth returns a link they open and approve in their bank, then complete_auth takes the address the " +
  "bank sends them back to.";

const main = async (): Promise<void> => {
  if (process.argv.includes("--health")) {
    process.exit(await runHealthCheck());
  }
  const deps = buildDeps();
  await serve({ name: "enable-banking", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), policy: POLICY, instructions: INSTRUCTIONS, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("enable-banking failed to start:", error);
  process.exit(1);
});
