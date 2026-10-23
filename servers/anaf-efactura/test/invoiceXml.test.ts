/**
 * What an invoice XML says about itself, and the line a user confirms.
 * The reader is the one the policy and the upload share (infra/xml.ts).
 */
import { describe, expect, it } from "vitest";

import { uploadProblems } from "../src/app/usecases/uploads.js";
import { accountProblems } from "../src/domain/invoiceXml.js";
import { SUMMARY_MAX, uploadSummary } from "../src/domain/uploadSummary.js";
import { parseXml, readInvoiceXml } from "../src/infra/xml.js";
import { POLICY } from "../src/mcp/policy.js";
import { CII_INVOICE, UBL_CREDIT_NOTE, UBL_INVOICE } from "./fixtures.js";

const NO_FLAGS = { extern: false, autofactura: false, executare: false };

describe("readInvoiceXml", () => {
  it("reads a UBL invoice: number, date, both parties, the amount due as written", () => {
    expect(readInvoiceXml(UBL_INVOICE)).toEqual({
      kind: "invoice",
      facts: {
        syntax: "UBL",
        document: "invoice",
        number: "EX-0042",
        issueDate: "2026-09-28",
        seller: { name: "Exemplu SRL", cif: "RO92345672" },
        // No VAT id on the buyer: CIUS-RO puts a non-payer's CUI on the legal entity.
        buyer: { name: "ACME & Sons SRL", cif: "87654329" },
        payable: "1234.50",
        currency: "RON",
        accounts: ["RO49AAAA1B31007593840000"],
      },
    });
  });

  it("finds every IBAN that fails its check digits, and leaves other account schemes alone", () => {
    const reading = readInvoiceXml(UBL_INVOICE.replace("RO49AAAA1B31007593840000", "RO49AAAA1B31007593840001"));
    expect(reading.kind === "invoice" && accountProblems(reading.facts)).toEqual([expect.stringContaining("check digits")]);
    const good = readInvoiceXml(UBL_INVOICE);
    expect(good.kind === "invoice" && accountProblems(good.facts)).toEqual([]);
    const other = readInvoiceXml(UBL_INVOICE.replace("RO49AAAA1B31007593840000", "123-456-789"));
    expect(other.kind === "invoice" && accountProblems(other.facts)).toEqual([]);
  });

  it("keeps the amount a string, trailing zero and all", () => {
    const reading = readInvoiceXml(UBL_INVOICE);
    expect(reading.kind === "invoice" && reading.facts.payable).toBe("1234.50");
  });

  it("reads a UBL credit note as a credit note", () => {
    const reading = readInvoiceXml(UBL_CREDIT_NOTE);
    expect(reading).toMatchObject({
      kind: "invoice",
      facts: { document: "credit note", number: "EX-CN-7", payable: "100.10", currency: "EUR", buyer: { cif: "DE123456749" } },
    });
  });

  it("reads CII, preferring the VAT registration and converting its date format", () => {
    expect(readInvoiceXml(CII_INVOICE)).toMatchObject({
      kind: "invoice",
      facts: {
        syntax: "CII",
        number: "CII-9",
        issueDate: "2026-09-30",
        seller: { name: "Exemplu SRL", cif: "RO92345672" },
        buyer: { name: "Client SRL", cif: "11223344" },
        payable: "0.10",
        currency: "RON",
      },
    });
  });

  it("does not guess an amount that is not a decimal", () => {
    const reading = readInvoiceXml(UBL_INVOICE.replace(">1234.50<", ">1.234,50<"));
    expect(reading.kind === "invoice" && reading.facts.payable).toBeUndefined();
  });

  it("calls anything else unreadable, saying why", () => {
    expect(readInvoiceXml("<Order/>")).toMatchObject({ kind: "unreadable" });
    expect(readInvoiceXml("not xml <")).toMatchObject({ kind: "unreadable" });
  });

  it("refuses a DOCTYPE outright, the one door to entity expansion", () => {
    expect(parseXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><Invoice>&a;</Invoice>')).toMatchObject({ ok: false });
  });
});

describe("uploadSummary", () => {
  it("leads with the environment, then the invoice, the buyer and the amount", () => {
    const line = uploadSummary(readInvoiceXml(UBL_INVOICE), { test: false, standard: "UBL", cif: "", flags: NO_FLAGS });
    expect(line).toBe(
      "FILE with ANAF e-Factura PRODUCTION (legal filing, cannot be withdrawn): invoice EX-0042 of 2026-09-28, " +
        "buyer ACME & Sons SRL (87654329), payable 1234.50 RON, seller Exemplu SRL (RO92345672); UBL",
    );
  });

  it("says plainly when it is only the test environment", () => {
    const line = uploadSummary(readInvoiceXml(UBL_INVOICE), { test: true, standard: "UBL", cif: "", flags: NO_FLAGS });
    expect(line.startsWith("TEST upload to ANAF's test environment (no legal effect):")).toBe(true);
  });

  it("names the flags and an explicit CIF", () => {
    const line = uploadSummary(readInvoiceXml(UBL_INVOICE), {
      test: false,
      standard: "UBL",
      cif: "92345672",
      flags: { extern: true, autofactura: true, executare: false },
    });
    expect(line.endsWith("; UBL, as CIF 92345672, foreign buyer, self-billed")).toBe(true);
  });

  it("stays one line of at most 300 characters whatever the document holds", () => {
    const long = UBL_INVOICE.replace("ACME &amp; Sons SRL", `${"A".repeat(500)}\nline two`);
    const line = uploadSummary(readInvoiceXml(long), {
      test: false,
      standard: "UBL",
      cif: "92345672",
      flags: { extern: true, autofactura: true, executare: true },
    });
    expect(line.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("payable 1234.50 RON");
  });

  it("says in capitals when nobody can tell which invoice it is", () => {
    const line = uploadSummary(readInvoiceXml("<Order/>"), { test: false, standard: "UBL", cif: "", flags: NO_FLAGS });
    expect(line).toContain("UNREADABLE XML");
  });
});

describe("the policy's summary", () => {
  const rule = POLICY["upload_invoice"];
  const summary = rule?.access === "money" ? rule.summary : undefined;

  const read = { name: "EX-0042.xml", size: Buffer.byteLength(UBL_INVOICE), sha256: "ab".repeat(32) };

  it("is a money rule built from the document the file held", () => {
    expect(summary?.({ xml: UBL_INVOICE, xml_read: read, test: false, standard: "UBL", cif: "" })).toContain("invoice EX-0042");
    expect(summary?.({ xml: UBL_INVOICE, xml_read: read, test: false })).toContain("file sha256 abababababab");
  });

  it("reads an absent test flag as the schema does: the test environment", () => {
    expect(summary?.({ xml: UBL_INVOICE, xml_read: read })).toMatch(/^TEST upload/);
  });

  it("refuses arguments whose file was not read first", () => {
    expect(summary?.({ xml: UBL_INVOICE })).toMatch(/do not validate; it will be refused/);
  });

  it("never throws, whatever it is handed: arguments the tool would refuse say so", () => {
    expect(summary?.({})).toMatch(/do not validate; it will be refused/);
    expect(summary?.({ xml: 42 })).toMatch(/do not validate; it will be refused/);
  });
});

describe("sellerProblems", () => {
  it("refuses a Romanian seller CIF that fails its control digit, and leaves a foreign one to ANAF", () => {
    const wrong = UBL_INVOICE.replace("<cbc:CompanyID>RO92345672</cbc:CompanyID>", "<cbc:CompanyID>RO92345670</cbc:CompanyID>");
    expect(uploadProblems(readInvoiceXml(wrong))).toEqual(["the seller's CIF RO92345670 fails its control digit (a digit is wrong or two are swapped)"]);
    expect(uploadProblems(readInvoiceXml(UBL_INVOICE))).toEqual([]);
    const foreign = UBL_INVOICE.replace("<cbc:CompanyID>RO92345672</cbc:CompanyID>", "<cbc:CompanyID>DE123456789</cbc:CompanyID>");
    expect(uploadProblems(readInvoiceXml(foreign))).toEqual([]);
  });
});
