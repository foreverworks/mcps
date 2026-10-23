#!/usr/bin/env node
import { packageIdentity, packageVersion, productIcons, serve } from "@foreverworks/mcp-kit";

import { runHealthCheck } from "./cli/health.js";
import { buildRegistries } from "./composition.js";
import { instructionsFor } from "./mcp/instructions.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";
import { loadedToolsets, productsOf } from "./mcp/toolsets.js";

/**
 * MCP server for several Google accounts at once: their mail, their
 * calendars, a Drive, and Docs, Sheets and Slides, through one server.
 *
 * It exists beside Google's own Gmail and Calendar MCP servers rather than
 * instead of them: a connector authenticates ONE Google account at a time, the
 * point of an agenda here is to see every account at once, and Google's Gmail
 * server can neither fetch attachment bytes nor sync by historyId.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout: over
 * stdio it IS the protocol channel, and a stray line there corrupts the session.
 *
 * GOOGLE_TOOLSETS picks the products whose tools it serves (every one by
 * default); the policy, the product icons, the instructions and the account
 * tools all follow from that one list. Every product's registry is built
 * whatever is loaded: building touches no network and no credential, and
 * consent and Meet reach into other products' registries.
 */
const main = async (): Promise<void> => {
  // One binary, two modes. `--health [gmail|calendar|drive|editors|tasks|contacts|meet]` is for a scheduled
  // check; it shares this server's composition, so the check can never drift from
  // what the server itself would do.
  const at = process.argv.indexOf("--health");
  if (at !== -1) {
    process.exit(await runHealthCheck(process.argv[at + 1]));
  }
  const loaded = loadedToolsets();
  const registries = buildRegistries();
  await serve({
    name: "google",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    products: productsOf(loaded).map(([product, tools]) => ({ icons: productIcons(import.meta.url, product), tools })),
    instructions: instructionsFor(loaded),
    policy: policyFor(loaded),
    register: (server) => registerAll(server, registries, loaded),
  });
};

main().catch((error: unknown) => {
  console.error("google failed to start:", error);
  process.exit(1);
});
