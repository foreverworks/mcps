#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "One network printer and its flatbed scanner, over IPP and eSCL. status first: state, paper, toner, whether it takes jobs. print sends a " +
  "PDF or image as the printer's own lossless raster, corrected for the printer's measured response when a calibration is loaded; dry_run " +
  "writes the raster and previews instead. scan saves what lies on the glass. print and scan act on paper in someone's home: call them only " +
  "when the user asks.";

/**
 * MCP server for one IPP Everywhere printer and its eSCL scanner. stdio by
 * default, HTTP when MCP_HTTP_PORT is set. Nothing is written to stdout:
 * over stdio it IS the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "printer", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("printer failed to start:", error);
  process.exit(1);
});
