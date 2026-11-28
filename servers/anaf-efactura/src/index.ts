#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { healthVerdict } from "./cli/health.js";
import { refreshVerdict } from "./cli/refresh.js";
import { buildDeps } from "./composition.js";
import { instructionsFor } from "./mcp/instructions.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";
import { loadToolsets, publicRefusal } from "./mcp/toolsets.js";

/**
 * MCP server for ANAF e-Factura and e-Transport.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout in that
 * mode: over stdio it IS the protocol channel.
 *
 * Two shell modes share this composition root, so neither can drift from what
 * the server itself would do. Each prints ONE `ANAF:` line (cli/verdict.ts):
 *
 *   --health             HELLO with the stored token, and the days left
 *   --refresh [--force]  the daily maintenance refresh (cli/refresh.ts)
 *
 * ANAF_EFACTURA_TOOLSETS picks the toolsets it serves (every one by default);
 * the policy, the tools registered, the instructions and whether the server
 * needs a grant at all follow from that one list (mcp/toolsets.ts).
 */
const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const shell = argv.includes("--refresh")
    ? refreshVerdict(process.env, { force: argv.includes("--force") })
    : argv.includes("--health")
      ? healthVerdict(process.env)
      : undefined;
  if (shell !== undefined) {
    const { code, line } = await shell;
    console.log(line);
    process.exit(code);
  }
  const { loaded, policy, mode } = loadToolsets(POLICY);
  const deps = buildDeps(process.env, { mode });
  await serve({
    name: "anaf-efactura",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: instructionsFor(loaded, mode),
    policy,
    publicRefusal: publicRefusal(mode),
    register: (server) => registerAll(server, deps, loaded),
  });
};

main().catch((error: unknown) => {
  console.error("anaf-efactura failed to start:", error);
  process.exit(1);
});
