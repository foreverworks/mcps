#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "The European Central Bank's euro foreign exchange reference rates (units of a currency per 1 EUR), read from the ECB's own XML: the rate in force" +
  " on a day since 1999, every currency or a window of fixings, and exact conversions between any two currencies, cross rates through the euro" +
  " included. A day without a fixing takes the last working day's, and every answer names the fixing's date. Rates are exact text: never round them again.";

/**
 * MCP server for the ECB's euro reference rates. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "ecb", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("ecb failed to start:", error);
  process.exit(1);
});
