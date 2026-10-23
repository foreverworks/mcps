#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { makeBroker } from "./app/broker.js";
import { buildDeps } from "./composition.js";
import { instructionsFor } from "./mcp/describe.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/** How often the clock's work runs: expiry and the queue; host probes refresh once a minute inside it. */
const TICK_MS = 15_000;

/**
 * MCP server for the device broker. Over HTTP (MCP_HTTP_PORT) one process holds
 * the state for every session that shares the devices; stdio works for a local
 * run against a catalog file. Nothing is written to stdout.
 */
const main = async (): Promise<void> => {
  const deps = await buildDeps();
  const broker = makeBroker(deps);
  await serve({ name: "devices", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: instructionsFor(deps.catalog), policy: POLICY, register: (server) => registerAll(server, broker, deps.catalog) });
  const tick = () => void broker.tick().catch((e: unknown) => deps.log(`devices: tick failed: ${String(e)}`));
  setInterval(tick, TICK_MS).unref();
  tick();
  deps.log(
    deps.catalogProblem === undefined
      ? `devices: ${deps.catalog.hosts.length} host(s), ${deps.catalog.devices.length} device(s) on ${deps.catalog.box}${deps.catalogNote === undefined ? "" : ` (${deps.catalogNote})`}`
      : `devices: no usable catalog, every tool answers why: ${deps.catalogProblem}`,
  );
};

main().catch((error: unknown) => {
  console.error("devices failed to start:", error);
  process.exit(1);
});
