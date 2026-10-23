/**
 * parse_invoice: a UBL document as plain JSON, every value its own text. The
 * documents are invented; their shapes follow EN 16931's UBL binding and the
 * CIUS-RO examples.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { connectInMemory, guard, inputFilesWith, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps } from "../src/app/ports.js";
import { parseInvoice } from "../src/app/usecases/parse.js";
import { makeFiles } from "../src/infra/files.js";
import { viewInvoiceXml } from "../src/infra/xml.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { absent, CII_INVOICE, errorOf, fakeDeps, sent, tempDir, UBL_CREDIT_NOTE, UBL_INVOICE, zipOf } from "./fixtures.js";

/** An invoice in EUR with its VAT also in RON, two rates, a discount, a delivery and a direct reference to an earlier invoice. */
const RICH_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>EXS-2026-0007</cbc:ID>
  <cbc:IssueDate>2026-10-01</cbc:IssueDate>
  <cbc:DueDate>2026-10-31</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Thank you for your business.
Second line kept.</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>
  <cbc:BuyerReference>PO-77</cbc:BuyerReference>
  <cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-30</cbc:EndDate></cac:InvoicePeriod>
  <cac:OrderReference><cbc:ID>ORD-12</cbc:ID></cac:OrderReference>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>EXS-2026-0003</cbc:ID><cbc:IssueDate>2026-08-01</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:ContractDocumentReference><cbc:ID>C-2025-4</cbc:ID></cac:ContractDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Exemplu</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>Strada Exemplului 1</cbc:StreetName>
      <cbc:CityName>SECTOR1</cbc:CityName>
      <cbc:PostalZone>010101</cbc:PostalZone>
      <cbc:CountrySubentity>RO-B</cbc:CountrySubentity>
      <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>RO92345672</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu Software SRL</cbc:RegistrationName><cbc:CompanyID>J99/1234/2020</cbc:CompanyID><cbc:CompanyLegalForm>Capital social 200 RON</cbc:CompanyLegalForm></cac:PartyLegalEntity>
    <cac:Contact><cbc:Name>Ana Popescu</cbc:Name><cbc:Telephone>+40 700 000 000</cbc:Telephone><cbc:ElectronicMail>ana@example.com</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PostalAddress>
      <cbc:StreetName>Musterstrasse 5</cbc:StreetName>
      <cbc:CityName>Berlin</cbc:CityName>
      <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456749</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:Delivery>
    <cbc:ActualDeliveryDate>2026-09-30</cbc:ActualDeliveryDate>
    <cac:DeliveryLocation><cac:Address><cbc:CityName>Berlin</cbc:CityName><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation>
  </cac:Delivery>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode name="Credit transfer">30</cbc:PaymentMeansCode>
    <cbc:PaymentID>EXS-2026-0007</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>RO49AAAA1B31007593840000</cbc:ID><cbc:Name>Exemplu Software SRL</cbc:Name><cac:FinancialInstitutionBranch><cbc:ID>AAAARO22</cbc:ID></cac:FinancialInstitutionBranch></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>30 days net</cbc:Note></cac:PaymentTerms>
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Loyalty discount</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">10.00</cbc:Amount>
    <cac:TaxCategory><cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
  </cac:AllowanceCharge>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1990.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">0.00</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">2000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">1990.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1990.00</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="EUR">10.00</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="EUR">1990.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:Note>September</cbc:Note>
    <cbc:InvoicedQuantity unitCode="HUR">16</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1200.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>Software development,
on site</cbc:Description>
      <cbc:Name>Development</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>DEV-H</cbc:ID></cac:SellersItemIdentification>
      <cac:CommodityClassification><cbc:ItemClassificationCode listID="STI">72200000-7</cbc:ItemClassificationCode></cac:CommodityClassification>
      <cac:ClassifiedTaxCategory><cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
      <cac:AdditionalItemProperty><cbc:Name>Project</cbc:Name><cbc:Value>Atlas</cbc:Value></cac:AdditionalItemProperty>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">75.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">800.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>License</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>AE</cbc:ID><cbc:Percent>0</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">400.0000</cbc:PriceAmount><cbc:BaseQuantity unitCode="H87">1</cbc:BaseQuantity></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

const view = (xml: string) => {
  const reading = viewInvoiceXml(xml);
  if (reading.kind !== "view") throw new Error(reading.why);
  return reading.view;
};

describe("the view of a UBL invoice", () => {
  it("carries the parties, lines, VAT, totals and payment terms, every value as the document writes it", () => {
    expect(view(RICH_INVOICE)).toEqual({
      syntax: "UBL",
      document: "invoice",
      customizationId: "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1",
      number: "EXS-2026-0007",
      issueDate: "2026-10-01",
      typeCode: "380",
      currency: "EUR",
      taxCurrency: "RON",
      notes: ["Thank you for your business.\nSecond line kept."],
      buyerReference: "PO-77",
      orderReference: "ORD-12",
      contractReference: "C-2025-4",
      precedingInvoices: [{ number: "EXS-2026-0003", issueDate: "2026-08-01" }],
      invoicePeriod: { start: "2026-09-01", end: "2026-09-30" },
      seller: {
        name: "Exemplu Software SRL",
        tradingName: "Exemplu",
        vatId: "RO92345672",
        legalId: "J99/1234/2020",
        legalForm: "Capital social 200 RON",
        address: { street: "Strada Exemplului 1", city: "SECTOR1", postalCode: "010101", countrySubentity: "RO-B", country: "RO" },
        contact: { name: "Ana Popescu", phone: "+40 700 000 000", email: "ana@example.com" },
      },
      buyer: {
        name: "Beispiel GmbH",
        vatId: "DE123456749",
        address: { street: "Musterstrasse 5", city: "Berlin", country: "DE" },
      },
      delivery: { date: "2026-09-30", address: { city: "Berlin", country: "DE" } },
      payment: {
        dueDate: "2026-10-31",
        terms: "30 days net",
        means: [
          {
            code: "30",
            name: "Credit transfer",
            paymentIds: ["EXS-2026-0007"],
            account: { id: "RO49AAAA1B31007593840000", name: "Exemplu Software SRL", bank: "AAAARO22" },
          },
        ],
      },
      allowancesCharges: [{ charge: false, amount: "10.00", reason: "Loyalty discount", vatCategory: "AE", vatPercent: "0" }],
      vat: {
        total: "0.00",
        totalInTaxCurrency: { amount: "0.00", currency: "RON" },
        breakdown: [
          { category: "AE", percent: "0", taxable: "1990.00", tax: "0.00", exemptionReason: "Reverse charge", exemptionReasonCode: "VATEX-EU-AE" },
        ],
      },
      totals: { lines: "2000.00", taxExclusive: "1990.00", taxInclusive: "1990.00", allowances: "10.00", payable: "1990.00" },
      lines: [
        {
          id: "1",
          quantity: "16",
          unitCode: "HUR",
          netAmount: "1200.00",
          name: "Development",
          description: "Software development,\non site",
          sellerItemId: "DEV-H",
          classifications: ["72200000-7"],
          properties: [{ name: "Project", value: "Atlas" }],
          price: "75.00",
          vatCategory: "AE",
          vatPercent: "0",
          note: "September",
        },
        { id: "2", quantity: "2", unitCode: "H87", netAmount: "800.00", name: "License", price: "400.0000", priceBaseQuantity: "1", vatCategory: "AE", vatPercent: "0" },
      ],
    });
  });

  it("keeps an amount's text exactly, trailing zeros and all", () => {
    expect(view(RICH_INVOICE).lines[1]?.price).toBe("400.0000");
  });

  it("reads a credit note's lines and its due date from the payment means", () => {
    const credit = UBL_CREDIT_NOTE.replace(
      "<cac:LegalMonetaryTotal>",
      "<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cbc:PaymentDueDate>2026-10-15</cbc:PaymentDueDate></cac:PaymentMeans>" +
        "<cac:LegalMonetaryTotal>",
    ).replace(
      "</CreditNote>",
      '<cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="C62">-1</cbc:CreditedQuantity><cbc:LineExtensionAmount currencyID="EUR">-100.10</cbc:LineExtensionAmount><cac:Item><cbc:Name>Refund</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">100.10</cbc:PriceAmount></cac:Price></cac:CreditNoteLine></CreditNote>',
    );
    const v = view(credit);
    expect(v).toMatchObject({ document: "credit note", number: "EX-CN-7", payment: { dueDate: "2026-10-15", means: [{ code: "30" }] } });
    expect(v.lines).toEqual([{ id: "1", quantity: "-1", unitCode: "C62", netAmount: "-100.10", name: "Refund", price: "100.10" }]);
  });

  it("leaves out what the document does not fill, instead of answering it empty", () => {
    const v = view(UBL_INVOICE);
    expect(v.lines).toEqual([]);
    expect(v).not.toHaveProperty("notes");
    expect(v).not.toHaveProperty("vat");
    expect(v.buyer).toEqual({ name: "ACME & Sons SRL", tradingName: "Acme Trading", legalId: "87654329" });
  });

  it("refuses CII, which ANAF's validator and PDF do not take either, and anything that is not an invoice", () => {
    expect(viewInvoiceXml(CII_INVOICE)).toMatchObject({ kind: "unreadable", why: expect.stringContaining("CII") });
    expect(viewInvoiceXml("<Order/>")).toMatchObject({ kind: "unreadable", why: expect.stringContaining("Order") });
    expect(viewInvoiceXml('<!DOCTYPE x [<!ENTITY e "x">]><Invoice/>')).toMatchObject({ kind: "unreadable", why: expect.stringContaining("DOCTYPE") });
  });
});

describe("parse_invoice, the use case", () => {
  const inbox = (name: string, content: string) => {
    const dir = tempDir("inbox");
    writeFileSync(join(dir, name), content);
    return dir;
  };

  it("reads a file by path and names what it read", async () => {
    const dir = inbox("invoice.xml", RICH_INVOICE);
    const deps = fakeDeps({ files: { ...fakeDeps().files, readInput: inputFilesWith([dir]) } });
    const out = await parseInvoice(deps, { xml: { name: "xml", source: { path: "invoice.xml" } }, archive: "" });
    expect(out).toMatchObject({ file: { name: "invoice.xml", size: Buffer.byteLength(RICH_INVOICE) }, invoice: { number: "EXS-2026-0007" } });
  });

  it("reads the one invoice inside an archive in the outbox, without downloading it again", async () => {
    const base = fakeDeps();
    mkdirSync(join(base.paths.downloadsDir, "2026-10"), { recursive: true });
    writeFileSync(
      join(base.paths.downloadsDir, "2026-10", "5001.zip"),
      zipOf([
        { name: "5001.xml", data: Buffer.from(RICH_INVOICE) },
        { name: "semnatura_5001.xml", data: Buffer.from("<Signature/>") },
      ]),
    );
    let downloads = 0;
    const deps: Deps = {
      ...base,
      files: makeFiles(inputFilesWith([])),
      anaf: { ...base.anaf, downloadMessage: async () => ((downloads += 1), { bytes: Buffer.alloc(0), refusal: undefined }) },
    };
    const out = await parseInvoice(deps, { xml: absent("xml"), archive: "2026-10/5001.zip" });
    expect(out).toMatchObject({ archive: { path: join(base.paths.downloadsDir, "2026-10", "5001.zip") }, invoice: { number: "EXS-2026-0007" } });
    expect(downloads).toBe(0);
  });

  it("takes one source, and refuses an archive outside the outbox", async () => {
    const deps = fakeDeps();
    expect(await errorOf(() => parseInvoice(deps, { xml: absent("xml"), archive: "" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => parseInvoice(deps, { xml: sent("xml", RICH_INVOICE), archive: "5001.zip" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => parseInvoice(deps, { xml: absent("xml"), archive: "../../etc/5001.zip" }))).toMatchObject({ kind: "input" });
  });

  it("says why a document cannot be read", async () => {
    expect(await errorOf(() => parseInvoice(fakeDeps(), { xml: sent("xml", CII_INVOICE), archive: "" }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("CII"),
    });
  });
});

describe("parse_invoice, through the guard", () => {
  it("answers structured content that matches its output schema", async () => {
    const server = new McpServer({ name: "anaf-efactura", version: "test" });
    registerAll(guard(server, { service: "anaf-efactura", policy: POLICY, log: () => undefined }), fakeDeps());
    const client = await connectInMemory(server);
    const bytes = Buffer.from(RICH_INVOICE);
    const { sha256 } = sent("xml", bytes).source as { sha256: string };
    const result = (await client.callTool({
      name: "parse_invoice",
      arguments: { xml: { content_base64: bytes.toString("base64"), sha256 } },
    })) as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(JSON.parse(result.content[0]?.text ?? "{}"));
    expect(result.structuredContent).toMatchObject({ invoice: { number: "EXS-2026-0007", totals: { payable: "1990.00" } } });
  });
});
