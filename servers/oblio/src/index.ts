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
  "Oblio invoicing for one company: its clients, products, series and VAT rates, and the invoices and " +
  "proformas it issues. Start with health: which account and company CIF the server works as, and whether the " +
  "account reaches that company. Before issuing, list_series gives each series and the number it issues next, " +
  "list_vat_rates the rate names a line uses, and list_clients and list_products find saved records. " +
  "list_invoices finds issued invoices by period, buyer, status (unpaid, paid, cancelled) and e-Factura state, " +
  "and is where to start for what is still owed; collect_invoice then records a payment against one. To take back " +
  "an invoice the client or ANAF already has, reverse_invoice issues its storno; cancel_invoice suits one never sent. " +
  "create_proforma is a write; create_invoice, invoice_from_proforma, collect_invoice, cancel_invoice, " +
  "restore_invoice, reverse_invoice and delete_invoice are money, because each makes, changes or unmakes a fiscal " +
  "document. Prices, quantities and amounts are decimal strings, and an issued document's answer carries its exact " +
  "total and the idempotency_key it was sent with. After an outcome_unknown failure, look the invoice up with " +
  "get_invoice before anything else; a retry carries the idempotency_key the failure reported, so Oblio refuses a " +
  "second copy, and a repeated collect_invoice finds the payment if it landed and records nothing.";

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
