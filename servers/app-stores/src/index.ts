#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "App Store Connect and Google Play for the apps these credentials reach: App Store and Play reviews with their replies, and what " +
  "testers sent from TestFlight. Start with health: which stores work and which apps and packages they reach. list_app_store_reviews " +
  "and list_play_reviews read reviews (Play's API only has the last 7 days); list_testflight_feedback reads screenshot and crash feedback, " +
  "and get_testflight_crash_log saves a crash log. reply_app_store_review and reply_play_review publish a reply in the developer's name, " +
  "visible to everyone: send only text the user approved.";

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
