#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "One Home Assistant instance, over its REST and WebSocket APIs. Start with health: the version, whether it runs, its time zone. " +
  "list_entities finds entity ids by domain, area or words; get_states reads their states and attributes; list_areas lists areas " +
  "with their devices and entities; history and logbook look back over a window; render_template answers with a template what no " +
  "other tool does in one call. list_actions shows the actions and their fields; call_action runs one. Actions on locks, alarms, " +
  "covers and valves (or the domains this deployment names) go through call_action_confirmed, which the user approves each call. " +
  "Run only what the user asks for: these act on a home. A call that fails with auth sends nothing more until the token is fixed: " +
  "Home Assistant counts every refused token as a failed login and may ban this address.";

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
