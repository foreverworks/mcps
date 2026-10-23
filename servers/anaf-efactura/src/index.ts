#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { healthVerdict } from "./cli/health.js";
import { refreshVerdict } from "./cli/refresh.js";
import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

/**
 * MCP server for ANAF e-Factura and e-Transport.
 *
 * stdio by default, or HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit
 * decides, and nothing here knows which. Nothing is logged to stdout in that
 * mode: over stdio it IS the protocol channel.
 *
 * Two shell modes share this composition root, so neither can drift from what
 * the server itself would do. Each prints ONE `ANAF:` line (cli/verdict.ts):
 *
 *   --health             HELLO with the stored token, and the days left
 *   --refresh [--force]  the daily maintenance refresh (cli/refresh.ts)
 */
const INSTRUCTIONS =
  "ANAF's e-Factura and e-Transport for one company: the invoices it received and sent, each one's signed " +
  "archive and PDF, ANAF's own validation of an invoice XML, the VAT registry, and filing an invoice. Start " +
  "with health: whether the stored grant works, for which CIF, and how many days it has left. list_invoices " +
  "(the last days, up to 60) or list_invoices_window (a date range, paginated) find messages; download_invoice " +
  "saves one signed archive to the outbox, checked, and invoice_pdf renders it; parse_invoice reads an " +
  "invoice (a file, or an archive in the outbox) as JSON without calling ANAF. To issue one, build_invoice " +
  "writes the XML from fields into the outbox and answers its path; validate_invoice runs ANAF's checks on an " +
  "XML without filing it. upload_invoice (to a company) and upload_invoice_b2c (to a person) are money: each " +
  "takes the XML by path, goes to ANAF's test environment unless test is false, does not file the same bytes in " +
  "production twice, and returns the uploadId upload_status follows. etransport_list reads e-Transport " +
  "declarations; etransport_file files one from its XML (money, test unless test is false) and etransport_status " +
  "says when its UIT is valid. lookup_company and validate_invoice need no grant. When health says the " +
  "grant is near its end, refresh_token renews it; if that fails, begin_authorization returns ANAF's page for " +
  "the certificate holder to open, and complete_authorization takes the address their browser lands on.";

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const shell = argv.includes("--refresh")
    ? refreshVerdict(process.env, { force: argv.includes("--force") })
    : argv.includes("--health")
      ? healthVerdict(process.env)
      : undefined;
  if (shell !== undefined) {
    const { code, line } = await shell;
    console.log(line);
    process.exit(code);
  }
  const deps = buildDeps(process.env);
  await serve({ name: "anaf-efactura", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("anaf-efactura failed to start:", error);
  process.exit(1);
});
