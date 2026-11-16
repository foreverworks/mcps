#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { vocabularyFor } from "./mcp/envelope.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Romania's road vignette (rovinietă) on eToll, for one signed-in account. Start with list_vehicles: each car's vignette, the day it ends and the days left. " +
  "list_tolls, list_invoices and notifications read the rest; service_status is CNAIR's status page. To buy: quote_vignette gives the prices per duration, " +
  "place_order (the user confirms one line) hands over the card payment page on euplatesc.ro, where the USER pays, then get_order shows it paid. " +
  "When a tool answers needs_login, call begin_login and have the user sign in in their browser.";

/**
 * MCP server for eToll, CNAIR's portal for the rovinietă, on its own REST
 * API with the account's Keycloak session. stdio by default, HTTP when
 * MCP_HTTP_PORT is set; `serve` in mcp-kit decides. Nothing is written to
 * stdout: over stdio it IS the protocol.
 */
const main = async (): Promise<void> => {
  const { deps } = buildDeps();
  await serve({
    name: "etoll",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: policyFor(deps),
    vocabulary: vocabularyFor(deps.loginScript),
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("etoll failed to start:", error);
  process.exit(1);
});
