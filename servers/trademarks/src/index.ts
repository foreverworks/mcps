#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { instructionsFor } from "./mcp/instructions.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";
import { loadToolsets } from "./mcp/toolsets.js";

/**
 * MCP server for trademark registers. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel. TRADEMARKS_TOOLSETS picks the toolsets it serves (every
 * one by default); the policy, the tools registered and the instructions
 * follow from it (mcp/toolsets.ts).
 */
const main = async (): Promise<void> => {
  const { loaded, policy } = loadToolsets(POLICY);
  const deps = buildDeps();
  await serve({
    name: "trademarks",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: instructionsFor(loaded),
    policy,
    register: (server) => registerAll(server, deps, policy),
  });
};

main().catch((error: unknown) => {
  console.error("trademarks failed to start:", error);
  process.exit(1);
});
