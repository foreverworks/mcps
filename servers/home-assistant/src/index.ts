#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "One Home Assistant instance, over its REST and WebSocket APIs. Start with health. list_entities finds entity ids by domain, area" +
  " or words, and get_states reads them. call_action runs an action; one on a lock, an alarm, a cover or a valve (or another domain" +
  " this deployment names) goes through call_action_confirmed, which the user approves on every call. Run only what the user asks " +
  "for: these act on a home.";

/**
 * MCP server for Home Assistant. stdio by default, HTTP when MCP_HTTP_PORT
 * is set. Nothing is written to stdout: over stdio it IS the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "home-assistant", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("home-assistant failed to start:", error);
  process.exit(1);
});
