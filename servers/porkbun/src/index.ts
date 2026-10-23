#!/usr/bin/env node
import { VENDOR_INSTRUCTIONS } from "./infra/vendor.js";
import { packageIdentity, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * Porkbun's official MCP tools (`@porkbunllc/mcp-server`, pinned), served by
 * mcp-kit: stdio by default, HTTP when MCP_HTTP_PORT is set, with the kit's
 * token auth, audit line, limits, and every `money` tool marked for the
 * client to confirm with its user. Nothing is written to stdout: over stdio it
 * IS the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  const policy = policyFor(deps.porkbun.catalog);
  await serve({ name: "porkbun", version: deps.porkbun.vendorVersion, ...packageIdentity(import.meta.url), instructions: VENDOR_INSTRUCTIONS, policy, register: (server) => registerAll(server, deps, policy) });
};

main().catch((error: unknown) => {
  console.error("porkbun failed to start:", error);
  process.exit(1);
});
