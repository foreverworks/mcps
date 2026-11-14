#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { startRelay } from "./relay.js";
import { settingsFrom } from "./settings.js";

/**
 * The relay: HTTP only, configured by the environment (README.md). It stands
 * in, on a client's machine, for an MCP server that runs on another, and
 * carries the files that server's tools take and hand back. Nothing is written
 * to stdout.
 */
const main = async (): Promise<void> => {
  const settings = settingsFrom(process.env);
  const upstreamToken = (await readFile(settings.upstreamTokenFile, "utf8")).trim();
  if (upstreamToken === "") throw new Error(`${settings.upstreamTokenFile} (MCP_RELAY_UPSTREAM_TOKEN_FILE) is empty`);
  await startRelay({ settings, upstreamToken });
};

main().catch((error: unknown) => {
  console.error("relay failed to start:", error);
  process.exit(1);
});
