#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "App Store Connect and Google Play for the apps these credentials reach: reviews and their replies, and TestFlight feedback with " +
  "crash logs. Start with health: which stores work and which apps they reach. reply_app_store_review and reply_play_review publish" +
  " in the developer's name, for everyone to see: send only text the user approved.";

/**
 * MCP server for App Store Connect and Google Play. stdio by default, HTTP
 * when MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS
 * the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "app-stores", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("app-stores failed to start:", error);
  process.exit(1);
});
