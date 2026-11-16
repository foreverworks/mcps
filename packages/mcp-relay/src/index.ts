#!/usr/bin/env node
import { startRelay } from "./relay.js";
import { settingsFrom } from "./settings.js";

/**
 * The relay: HTTP only, configured by the environment (README.md). It stands
 * in, on a client's machine, for an MCP server that runs on another, and
 * carries the files that server's tools take and hand back. Nothing is written
 * to stdout.
 */
const main = async (): Promise<void> => {
  await startRelay({ settings: settingsFrom(process.env) });
};

main().catch((error: unknown) => {
  console.error("relay failed to start:", error);
  process.exit(1);
});
