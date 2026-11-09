#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { runHealthCheck } from "./cli/health.js";
import { buildDeps } from "./composition.js";
import { asAppError, remedyFor } from "./domain/errors.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * MCP server for Oblio, the Romanian invoicing platform.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout: over
 * stdio it IS the protocol channel, and a stray line there corrupts the session.
 */
const INSTRUCTIONS =
  "Oblio invoicing for one company: its clients, products, series and VAT rates, and the invoices and proformas it issues. Start " +
  "with health: which company the server works as. Before issuing, list_series gives the number each series issues next and " +
  "list_vat_rates the rate names a line takes. list_invoices is where to start for what is still owed. After an outcome_unknown " +
  "failure, look the invoice up with get_invoice before anything else; a retry with the idempotency_key the failure reported makes " +
  "Oblio refuse a second copy.";

const main = async (): Promise<void> => {
  if (process.argv.includes("--health")) {
    process.exit(await runHealthCheck());
  }
  const deps = buildDeps();
  await serve({
    name: "oblio",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: policyFor(deps),
    // A payment's resolve reads the invoice, and can fail in this server's words (no such invoice, more than it owes).
    vocabulary: { asAppError, remedyFor },
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("oblio failed to start:", error);
  process.exit(1);
});
