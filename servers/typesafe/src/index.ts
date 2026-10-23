#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "TypeSafe's Jev: typed, calibrated judgments (yes/no probability, one-of-a-set, a degree on levels) over a state you give, " +
  "in about half a second and for fractions of a cent. Use it where a judgment is narrow and repeated, above all over many " +
  "rows (ask_batch), rather than reading every row yourself; keep rules, lookups and arithmetic in code.";

/**
 * MCP server for TypeSafe's System One API. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "typesafe", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("typesafe failed to start:", error);
  process.exit(1);
});
