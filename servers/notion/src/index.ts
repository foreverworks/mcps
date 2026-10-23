#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { runHealthCheck } from "./cli/health.js";
import { buildDeps } from "./composition.js";
import { labelsIn } from "./infra/tokens.js";
import { instructionsFor } from "./mcp/instructions.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * MCP server for Notion workspaces, one integration token each, on Notion's
 * REST API.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout: over
 * stdio it IS the protocol channel, and a stray line there corrupts the session.
 */
const main = async (): Promise<void> => {
  if (process.argv.includes("--health")) {
    process.exit(await runHealthCheck());
  }
  const deps = buildDeps();
  const instructions = instructionsFor(labelsIn(deps.accounts.source));
  await serve({ name: "notion", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("notion failed to start:", error);
  process.exit(1);
});
