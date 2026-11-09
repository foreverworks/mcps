#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Infrared remote control through BroadLink RM blasters on the local network: devices lists each device and its buttons, and press" +
  " sends one by name. A button marked for approval (one that can start heating, say) goes through press_confirmed and an untested " +
  "code through send_code; the user approves each of those calls. IR goes one way: nothing here can tell whether a device is on, " +
  "and a toggle pressed twice undoes itself. Press only what the user asks for: these act on devices in someone's home.";

/**
 * MCP server for BroadLink RM infrared blasters. stdio by default, HTTP when
 * MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS the
 * protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "smart-home", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("smart-home failed to start:", error);
  process.exit(1);
});
