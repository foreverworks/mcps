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
  "ANAF's e-Factura and e-Transport for one company: the invoices it received and sent, with their archives, PDFs and contents, " +
  "ANAF's own validation, the VAT registry, and filing. Start with health: whether the grant works, for which CIF, and for how many" +
  " more days. To issue an invoice: build_invoice, validate_invoice, then upload_invoice (to a company) or upload_invoice_b2c (to a" +
  " person), and upload_status. Filing is money, and every filing tool goes to ANAF's test environment unless test is false. When " +
  "the grant nears its end, refresh_token renews it; if that fails, begin_authorization needs the certificate holder.";

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
