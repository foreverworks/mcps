#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Mobbin's library of real app screens, flows and sections, through Mobbin's own MCP server and one Mobbin account this server holds a grant for. " +
  "Start with health. When it says there is no grant, or a call answers not_authorized, the account's owner signs in: begin_authorization, they open its link in a browser signed in to Mobbin, " +
  "then complete_authorization with the address the browser lands on. After that search_screens, search_flows and search_sections work; a deep search spends the account's AI credits, a standard one does not.";

/**
 * MCP server bridging Mobbin's hosted MCP server. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = await buildDeps(process.env);
  await serve({
    name: "mobbin",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: POLICY,
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("mobbin failed to start:", error);
  process.exit(1);
});
