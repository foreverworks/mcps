/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs the deployment's environment (ANAF_CONFIG,
 * ANAF_STATE_DIR, see README); everything in test/ does not.
 *
 *   npm run build -w @foreverworks/mcp-anaf-efactura
 *   npx tsx scripts/smoke.ts                  # READ-ONLY: health, token_status, list_invoices (3 days),
 *                                             # then the public tools, and for the newest message: its
 *                                             # archive (1 of ANAF's 10 daily downloads), verify_signature
 *                                             # of that archive (none), invoice_pdf (1 more)
 *   npx tsx scripts/smoke.ts --public-only    # only the tools that need no grant (validate_invoice,
 *                                             # invoice_pdf from XML, verify_signature's ANAF fallback,
 *                                             # lookup_company); any app.json will do
 *   npx tsx scripts/smoke.ts --allow-writes   # also refresh_token (no force) and begin_authorization
 *
 * READ-ONLY unless --allow-writes is passed, and even then it never uploads:
 * a production upload is a filing with the tax authority, and a smoke test is
 * not the place to make one. The two writes it can do are harmless on their
 * own: refresh_token without force is a no-op while the token has its cushion,
 * and begin_authorization only remembers a state nobody will complete.
 */
import { createHash } from "node:crypto";

import { type Client, connectSmoke } from "@foreverworks/mcp-kit";

const allowWrites = process.argv.includes("--allow-writes");
const publicOnly = process.argv.includes("--public-only");

/**
 * The smallest invoice ANAF's validator accepts (checked live, 2026-09-30):
 * CIUS-RO customization, a Bucharest sector as the city, a payee account for
 * a credit transfer, and CUIs with valid check digits. Invented parties.
 */
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>SMOKE-1</cbc:ID>
  <cbc:IssueDate>2026-09-30</cbc:IssueDate>
  <cbc:DueDate>2026-10-30</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>Str. Exemplu 1</cbc:StreetName><cbc:CityName>SECTOR1</cbc:CityName><cbc:CountrySubentity>RO-B</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>RO92345672</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu Furnizor SRL</cbc:RegistrationName><cbc:CompanyID>J99/1/2020</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PostalAddress><cbc:StreetName>Str. Client 2</cbc:StreetName><cbc:CityName>Cluj-Napoca</cbc:CityName><cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity><cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu Client SRL</cbc:RegistrationName><cbc:CompanyID>87654329</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>RO49AAAA1B31007593840000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">121.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">121.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">100.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Serviciu exemplu</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>21</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">100.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

/**
 * A document as a script sends one: its bytes as base64 with their sha256,
 * which the server checks before anything reaches ANAF.
 */
const asFile = (text: string, filename: string) => {
  const bytes = Buffer.from(text, "utf8");
  return { content_base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), filename };
};

const parse = (result: unknown): Record<string, unknown> => {
  const text = (result as { content: { text: string }[] }).content[0]?.text ?? "{}";
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
};

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const t0 = Date.now();
  const out = parse(await client.callTool({ name, arguments: args }));
  console.log(`\n${name} (${Date.now() - t0} ms):`, JSON.stringify(out).slice(0, 600));
  return out;
};

/** The tools that need no grant: they must work even when the grant has expired. */
const publicTools = async (client: Client) => {
  const valid = await call(client, "validate_invoice", { xml: asFile(SAMPLE, "SMOKE-1.xml") });
  console.log(`validate_invoice -> valid: ${String(valid["valid"])}`);
  const broken = await call(client, "validate_invoice", { xml: asFile(SAMPLE.replace("87654329", "87654321"), "SMOKE-1-bad.xml") });
  console.log(`validate_invoice (bad buyer CUI) -> valid: ${String(broken["valid"])}`);
  await call(client, "invoice_pdf", { xml: asFile(SAMPLE, "SMOKE-1.xml"), save_dir: "smoke" });
  // A seal with nothing in it: the local check cannot decide, so ANAF answers (valid: false).
  const fallback = await call(client, "verify_signature", {
    xml: asFile(SAMPLE, "SMOKE-1.xml"),
    signature: asFile('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>', "semnatura_SMOKE-1.xml"),
  });
  console.log(`verify_signature (empty seal) -> valid: ${String(fallback["valid"])}, checkedBy: ${String(fallback["checkedBy"])}`);
  // The Ministry of Finance (checked 2026-09-30), and a valid code nobody holds.
  await call(client, "lookup_company", { cifs: ["RO4221306", "9999999994"] });
};

const main = async () => {
  // Over stdio the server needs the deployment's paths, so the whole environment
  // goes through (connectSmoke's default).
  const client = await connectSmoke();

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).toSorted().join(", "));

  if (publicOnly) {
    await publicTools(client);
    await client.close();
    return;
  }

  const health = await call(client, "health");
  if (health["error"] !== undefined) {
    await client.close();
    process.exit(1);
  }
  await call(client, "token_status");
  const list = await call(client, "list_invoices", { zile: 3 });
  console.log(`list_invoices 3d -> ${String(list["count"] ?? "?")} messages, notice: ${String(list["notice"] ?? "none")}`);

  // A rejected argument never reaches ANAF: the failure shape, for free.
  await call(client, "list_invoices", { zile: 90 });

  await publicTools(client);
  // The newest filed message: two of ANAF's ten downloads a day for it (the archive, then the PDF).
  const newest = (list["messages"] as readonly { readonly id?: string; readonly kind?: string }[] | undefined)?.find(
    (m) => m.kind === "sent" || m.kind === "received",
  );
  if (newest?.id !== undefined) {
    await call(client, "download_invoice", { message_id: newest.id, save_dir: "smoke" });
    const sealed = await call(client, "verify_signature", { archive: `smoke/${newest.id}.zip` });
    console.log(`verify_signature (${newest.id}) -> valid: ${String(sealed["valid"])}, checkedBy: ${String(sealed["checkedBy"])}`);
    await call(client, "invoice_pdf", { message_id: newest.id, save_dir: "smoke" });
  }

  if (allowWrites) {
    await call(client, "refresh_token", { force: false });
    await call(client, "begin_authorization");
  }
  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
