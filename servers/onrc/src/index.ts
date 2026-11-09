#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { vocabularyFor } from "./mcp/envelope.js";
import { policy } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Romania's trade register portal (myportal.onrc.ro) for one signed-in account: its filings and their status, their documents, the" +
  " fee notes and invoices. Nothing here files anything yet. The session is the user's: when a tool answers needs_login, " +
  "begin_login gives a URL to open in the browser where they are signed in, and complete_login takes the address it lands on.";

/**
 * MCP server for the ONRC portal, on its own REST API with the user's
 * Keycloak session. stdio by default, HTTP when MCP_HTTP_PORT is set; `serve`
 * in mcp-kit decides. Nothing is written to stdout: over stdio it IS the
 * protocol.
 */
const main = async (): Promise<void> => {
  const { deps } = buildDeps();
  await serve({
    name: "onrc",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy,
    vocabulary: vocabularyFor(deps.loginScript),
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("onrc failed to start:", error);
  process.exit(1);
});
