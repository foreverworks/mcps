import { describe, expect, it } from "vitest";

import { parseRef } from "../src/domain/document.js";
import { documentProblems, ensureValid, invoiceProblems } from "../src/domain/rules.js";
import {
  SUMMARY_MAX,
  summarizeCancel,
  summarizeDelete,
  summarizeFromProforma,
  summarizeInvoice,
} from "../src/domain/summary.js";
import { errorOf, invoice } from "./helpers.js";

describe("parseRef", () => {
  it("trims but never parses the number", () => {
    // Series restart and some numbers are zero-padded. Reading "0042" as 42 would lose the document.
    expect(parseRef(" FCT ", " 0042 ")).toEqual({ seriesName: "FCT", number: "0042" });
  });

  it("points at list_series when the series is blank", async () => {
    expect((await errorOf(() => parseRef("", "1")))?.message).toContain("list_series");
    expect((await errorOf(() => parseRef("FCT", "  ")))?.kind).toBe("input");
  });
});

describe("the document rules", () => {
  it("pass a plain invoice", () => {
    expect(invoiceProblems(invoice())).toEqual([]);
  });

  it("refuse a price with more decimals than the document keeps, which Oblio would round silently", () => {
    const problems = documentProblems(invoice({ products: [{ name: "x", price: "10.005", quantity: "1", vatPercentage: "21", vatIncluded: false }] }));
    expect(problems.join()).toContain("more than 2 decimals");
    expect(documentProblems(invoice({ precision: 3, products: [{ name: "x", price: "10.005", quantity: "1", vatPercentage: "21", vatIncluded: false }] }))).toEqual([]);
  });

  it("refuse a zero quantity, a negative price and a rate over 100", () => {
    const problems = documentProblems(
      invoice({ products: [{ name: "x", price: "-1", quantity: "0", vatPercentage: "121", vatIncluded: false }] }),
    ).join();
    expect(problems).toContain("negative");
    expect(problems).toContain("above zero");
    expect(problems).toContain("between 0 and 100");
  });

  it("refuse a due date before the issue date", () => {
    expect(documentProblems(invoice({ issueDate: "2026-09-28", dueDate: "2026-09-01" })).join()).toContain("due_date");
  });

  it("ask a receipt for its series and a bank payment for its reference", () => {
    expect(invoiceProblems(invoice({ collect: { type: "Chitanta" } })).join()).toContain("series_name");
    expect(invoiceProblems(invoice({ collect: { type: "Ordin de plata" } })).join()).toContain("document_number");
    expect(invoiceProblems(invoice({ collect: { type: "Ordin de plata", documentNumber: "OP 7001" } }))).toEqual([]);
  });

  it("name every problem at once, as an input failure", async () => {
    const error = await errorOf(() => ensureValid(["a", "b"]));
    expect(error).toMatchObject({ kind: "input" });
    expect(error?.message).toContain("a; b");
  });
});

describe("the one-line summaries a user confirms", () => {
  it("say series, client, CIF, total with VAT and currency", () => {
    const line = summarizeInvoice(invoice({ issueDate: "2026-09-28", dueDate: "2026-10-28" }));
    expect(line).toBe(
      "Issue invoice in series FCT to Client SRL (CIF RO87654329): 1210.00 RON incl. VAT 210.00 (1 line), dated 2026-09-28, due 2026-10-28",
    );
  });

  it("say the payment and the email when there are some", () => {
    const line = summarizeInvoice(
      invoice({ collect: { type: "Ordin de plata", documentNumber: "OP 7001" }, sendEmail: true, currency: "EUR" }),
    );
    expect(line).toContain("1210.00 EUR");
    expect(line).toContain("marked paid by Ordin de plata OP 7001");
    expect(line).toContain("emailed by Oblio to the client's saved email");
  });

  it("stay one line of at most 300 characters whatever the client is called", () => {
    const line = summarizeInvoice(invoice({ client: { name: `A\nvery ${"long ".repeat(200)}name` } }));
    expect(line.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("(no CIF)");
    expect(line).toContain("1210.00 RON");
  });

  it("name the document for cancel, delete and invoice-from-proforma", () => {
    const ref = { seriesName: "FCT", number: "0042" };
    expect(summarizeCancel({ ref })).toContain("FCT 0042 (total not given, so not checked)");
    expect(summarizeDelete({ ref, expectTotal: "121.00" })).toMatch(/^DELETE invoice FCT 0042 totalling 121.00 permanently/);
    expect(summarizeFromProforma({ invoiceSeries: "FCT", proforma: { seriesName: "PR", number: "0007" } })).toContain(
      "from proforma PR 0007",
    );
  });
});
