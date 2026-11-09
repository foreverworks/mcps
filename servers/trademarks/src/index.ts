#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Trademark registers: whether a name is already a registered or pending mark. search_marks checks one name across offices, " +
  "optionally by Nice class; get_mark, mark_history and mark_documents read one mark in depth. Each office answers for itself, and " +
  "one that could not be searched says why: never read that as clear. health says which sources work.";

/**
 * MCP server for trademark registers. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "trademarks", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("trademarks failed to start:", error);
  process.exit(1);
});
