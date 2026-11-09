#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "The National Bank of Romania's reference exchange rates (RON per unit of a currency), read from BNR's own XML: the rate in force" +
  " on a day, conversions to and from RON, every fixing in a window, and the yearly average ANAF uses in the D212. Rates are exact " +
  "text: never round them again.";

/**
 * MCP server for BNR's exchange rates. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "bnr", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("bnr failed to start:", error);
  process.exit(1);
});
