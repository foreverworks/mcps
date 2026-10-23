/**
 * build_invoice: CIUS-RO UBL from fields. Every built file is held to the
 * answer ANAF's validator gave for exactly its bytes (recorded once by
 * scripts/record-validation.ts, test/fixtures/validation), its totals to the
 * kit's EN 16931 rule, and its reading to the line upload_invoice confirms.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { connectInMemory, documentTotal, guard, inputFilesWith, lineAmount, McpServer, sha256Of } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deps, UploadQuery } from "../src/app/ports.js";
import { buildInvoice, builtFileName } from "../src/app/usecases/build.js";
import { uploadConfirmationLine } from "../src/app/usecases/uploads.js";
import { buildInvoiceXml, draftProblems, type InvoiceDraft, normalDraft } from "../src/domain/invoiceBuild.js";
import { verdictOf } from "../src/domain/validation.js";
import { makeFiles, withOutbox } from "../src/infra/files.js";
import { readInvoiceXml, viewInvoiceXml } from "../src/infra/xml.js";
import { type BuildArgs, parseBuildArgs, toDraft } from "../src/mcp/buildArgs.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { BUILD_CASES, type BuildCase, FOREIGN_BUYER_CASES, identifiedVariant } from "./buildCases.js";
import { anafStub, errorOf, fakeDeps, tempDir } from "./fixtures.js";

afterEach(() => vi.unstubAllEnvs());

const draftOf = (raw: unknown): InvoiceDraft => normalDraft(toDraft(parseBuildArgs(raw)));
const built = (raw: unknown) => buildInvoiceXml(draftOf(raw));

type Recording = { readonly sha256: string; readonly endpoint: string; readonly recordedOn: string; readonly answer: { stare: string; trace_id: string; Messages?: { message?: string }[] } };
const recording = (name: string): Recording =>
  JSON.parse(readFileSync(new URL(`./fixtures/validation/${name}.json`, import.meta.url), "utf8")) as Recording;

const names = Object.keys(BUILD_CASES) as BuildCase[];
const foreign = (name: BuildCase): name is (typeof FOREIGN_BUYER_CASES)[number] => (FOREIGN_BUYER_CASES as readonly string[]).includes(name);

describe("every built file, against ANAF's recorded verdict on its exact bytes", () => {
  it.each(names)("%s", (name) => {
    const { xml } = built(BUILD_CASES[name]);
    const recorded = recording(name);
    expect(recorded.endpoint).toBe("https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/FACT1");
    // Not these bytes: the builder changed; run scripts/record-validation.ts --send for this case.
    expect(sha256Of(Buffer.from(xml, "utf8"))).toBe(recorded.sha256);
    const verdict = verdictOf(recorded.answer);
    if (!foreign(name)) {
      expect(verdict).toMatchObject({ valid: true, findings: [] });
      return;
    }
    // ANAF's validator has no extern flag: a foreign buyer is refused by its identity check alone...
    expect(verdict.findings).toEqual([{ rule: "ERRIdentif", text: "nu a fost identificat cui cumparator" }]);
    // ...and the same invoice with a Romanian-format buyer id passes everything else.
    const variant = built(identifiedVariant(name)).xml;
    const identified = recording(`${name}.identified`);
    expect(sha256Of(Buffer.from(variant, "utf8"))).toBe(identified.sha256);
    expect(verdictOf(identified.answer)).toMatchObject({ valid: true, findings: [] });
  });
});

describe("the totals, by the one EN 16931 rule", () => {
  it.each(names)("%s: the file states the kit's documentTotal, line by line and per rate", (name) => {
    const draft = draftOf(BUILD_CASES[name]);
    const { xml, totals } = buildInvoiceXml(draft);
    const expected = documentTotal(
      draft.lines.map((l) => ({ price: l.price, quantity: l.quantity, vatPercentage: l.vatPercent, vatCategory: l.vatCategory })),
      draft.currency,
    );
    expect(totals).toMatchObject(expected);
    const reading = viewInvoiceXml(xml);
    if (reading.kind !== "view") throw new Error(reading.why);
    const view = reading.view;
    expect(view.totals).toEqual({ lines: expected.net, taxExclusive: expected.net, taxInclusive: expected.gross, payable: expected.gross });
    expect(view.vat?.total).toBe(expected.vat);
    expect(view.vat?.breakdown?.map((b) => [b.category, b.taxable, b.tax])).toEqual(expected.byRate.map((r) => [r.vatCategory, r.net, r.vat]));
    expect(view.lines.map((l) => l.netAmount)).toEqual(draft.lines.map((l) => lineAmount({ price: l.price, quantity: l.quantity, vatPercentage: l.vatPercent })));
  });

  it("rounds each line, then VAT once per rate on the sum: 16 x 150, 99.99 and 3 x 0.333", () => {
    const { totals } = built(BUILD_CASES["ron-standard"]);
    expect(totals).toMatchObject({ net: "2500.99", vat: "525.11", gross: "3026.10" });
    expect(totals.byRate.map((r) => [r.vatPercentage, r.net, r.vat])).toEqual([
      ["21", "2499.99", "525.00"],
      ["11", "1.00", "0.11"],
    ]);
  });

  it("states the VAT in RON at the rate given, for an invoice in another currency", () => {
    const raw = { ...BUILD_CASES["usd-export"], lines: [{ name: "Support", quantity: "1", price: "1000.00", vat_percent: "21" }] };
    expect(built(raw).totals).toMatchObject({ vat: "210.00", vatInRon: "917.95" });
    expect(built(raw).xml).toContain('<cbc:TaxAmount currencyID="RON">917.95</cbc:TaxAmount>');
  });

  it("is what upload_invoice will confirm: the payable it reads back is the computed total", () => {
    for (const name of names) {
      const { xml, totals } = built(BUILD_CASES[name]);
      const line = uploadConfirmationLine(readInvoiceXml, {
        xml,
        cif: "",
        standard: "UBL",
        extern: false,
        autofactura: false,
        executare: false,
        test: false,
      });
      expect(line).toContain(`payable ${totals.gross} ${totals.currency}`);
    }
  });
});

describe("the draft, held to what ANAF would refuse", () => {
  const base = BUILD_CASES["ron-standard"];
  const problems = (over: Record<string, unknown>) => draftProblems(draftOf({ ...base, ...over }));
  const withSeller = (over: Record<string, unknown>) => ({ seller: { ...base.seller, ...over } });
  const withBuyer = (over: Record<string, unknown>) => ({ buyer: { ...base.buyer, ...over } });

  it("passes a good one", () => {
    expect(problems({})).toEqual([]);
  });

  it("checks the check digits a typo breaks: CIF, CNP, IBAN", () => {
    expect(problems(withSeller({ vat_id: "RO92345675" }))).toEqual([expect.stringContaining("the seller's VAT id")]);
    expect(problems(withBuyer({ vat_id: undefined, company_id: "1850101990008" }))).toEqual([expect.stringContaining("CNP 1850101990008 fails")]);
    expect(problems({ payment: { iban: "RO49AAAA1B31007593840001" } })).toEqual([expect.stringContaining("IBAN")]);
  });

  it("takes a county as CJ or RO-CJ, needs one in Romania, and writes Bucharest's sector as ANAF reads it", () => {
    expect(draftOf({ ...base, ...withBuyer({ address: { ...base.buyer.address, county: "cj" } }) }).buyer.address.county).toBe("RO-CJ");
    expect(problems(withBuyer({ address: { ...base.buyer.address, county: undefined } }))).toEqual([expect.stringContaining("needs its county")]);
    expect(problems(withBuyer({ address: { ...base.buyer.address, county: "XX" } }))).toEqual([expect.stringContaining("not a Romanian county")]);
    expect(draftOf(base).seller.address.city).toBe("SECTOR1");
    expect(problems(withSeller({ address: { ...base.seller.address, city: "Bucuresti" } }))).toEqual([expect.stringContaining("SECTOR1 to SECTOR6")]);
  });

  it("holds each VAT category to its rules", () => {
    const line = (over: Record<string, unknown>) => ({ lines: [{ name: "x", quantity: "1", price: "10", ...over }] });
    expect(problems(line({ vat_percent: "0" }))).toEqual([expect.stringContaining("S needs a rate above 0")]);
    expect(problems(line({ vat_category: "AE", vat_percent: "21" }))).toEqual([expect.stringContaining("AE has a rate of 0")]);
    expect(problems(line({ vat_category: "E" }))).toEqual([expect.stringContaining("needs an exemption reason")]);
    expect(problems({ ...line({ vat_category: "AE" }), ...withBuyer({ vat_id: undefined, company_id: undefined }) })).toContain(
      "reverse charge (AE) needs the buyer's VAT id or company_id (BR-AE-02)",
    );
    expect(problems({ lines: [...base.lines, { name: "x", quantity: "1", price: "1", vat_category: "O" }] })).toEqual(
      expect.arrayContaining([expect.stringContaining("BR-O-11"), expect.stringContaining("BR-O-02")]),
    );
    expect(problems({ ...line({ vat_category: "O" }), ...withSeller({ vat_id: undefined }), ...withBuyer({ vat_id: undefined }) })).toEqual([]);
  });

  it("asks for what EN 16931 and CIUS-RO require around the money", () => {
    expect(problems({ currency: "EUR" })).toEqual([expect.stringContaining("give vat_exchange_rate")]);
    expect(problems({ due_date: undefined, payment: { iban: base.payment.iban } })).toEqual([expect.stringContaining("BR-CO-25")]);
    expect(problems({ payment: { means_code: "30" } })).toEqual([expect.stringContaining("BR-61")]);
    expect(problems({ due_date: "2026-09-01" })).toEqual([expect.stringContaining("before the issue date")]);
    expect(problems({ number: "INV-A" })).toEqual([expect.stringContaining("BR-RO-010")]);
    // The tool's schema refuses a negative price first; the draft's own rule holds for any other caller.
    const draft = draftOf(base);
    expect(draftProblems({ ...draft, lines: [{ ...draft.lines[0]!, price: "-1" }] })).toEqual([expect.stringContaining("never negative")]);
  });

  it("names every problem at once", () => {
    expect(problems({ number: "X", currency: "EUR", ...withSeller({ vat_id: "RO1" }) }).length).toBe(3);
  });
});

describe("build_invoice, the use case", () => {
  const depsWithOutbox = (): Deps => {
    const base = fakeDeps();
    mkdirSync(base.paths.downloadsDir, { recursive: true });
    return { ...base, files: makeFiles(withOutbox(inputFilesWith([]), base.paths.downloadsDir)) };
  };
  const args = (raw: unknown, over: { fileName?: string; saveDir?: string } = {}) => ({ draft: toDraft(parseBuildArgs(raw)), fileName: over.fileName ?? "", saveDir: over.saveDir ?? "" });

  it("saves the file to the outbox under the invoice number, with its sha256 and totals", async () => {
    const deps = depsWithOutbox();
    const out = await buildInvoice(deps, args(BUILD_CASES["ron-standard"]));
    const bytes = readFileSync(out.path);
    expect(out).toMatchObject({
      path: join(deps.paths.downloadsDir, "EXS-2026-0101.xml"),
      bytes: bytes.length,
      sha256: sha256Of(bytes),
      invoice: { number: "EXS-2026-0101", payable: "3026.10", currency: "RON", seller: { cif: "RO92345672" } },
      totals: { lines: "2500.99", vat: "525.11", payable: "3026.10", currency: "RON" },
    });
    expect(out.sha256).toBe(recording("ron-standard").sha256);
    expect(out).not.toHaveProperty("extern");
  });

  it("finds the same file for the same invoice, and never replaces a different one", async () => {
    const deps = depsWithOutbox();
    const first = await buildInvoice(deps, args(BUILD_CASES["ron-standard"]));
    expect((await buildInvoice(deps, args(BUILD_CASES["ron-standard"]))).path).toBe(first.path);
    const changed = await buildInvoice(deps, args({ ...BUILD_CASES["ron-standard"], notes: ["Changed."] }));
    expect(changed.path).toBe(join(deps.paths.downloadsDir, "EXS-2026-0101-2.xml"));
    expect(readFileSync(first.path).toString()).toContain("Thank you for your business.");
  });

  it("says a foreign buyer's file goes up with extern: true", async () => {
    expect(await buildInvoice(depsWithOutbox(), args(BUILD_CASES["eur-reverse-charge"]))).toMatchObject({ extern: true });
  });

  it("writes only inside the outbox, under a name it can hold, and nothing at all for a draft with problems", async () => {
    const deps = depsWithOutbox();
    expect(builtFileName("EXS 2026/0101")).toBe("EXS-2026-0101.xml");
    expect(builtFileName("../../x.XML")).toBe("x.xml");
    expect((await buildInvoice(deps, args(BUILD_CASES["storno"], { saveDir: "2026-10", fileName: "storno" }))).path).toBe(
      join(deps.paths.downloadsDir, "2026-10", "storno.xml"),
    );
    expect(await errorOf(() => buildInvoice(deps, args(BUILD_CASES["storno"], { saveDir: "../elsewhere" })))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => buildInvoice(deps, args({ ...BUILD_CASES["storno"], number: "STORNO" })))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("BR-RO-010"),
    });
  });
});

describe("the outbox as an input root", () => {
  it("lets a tool read a file this server saved there by its path, and nothing else through it", async () => {
    const outbox = tempDir("outbox");
    const inbox = tempDir("inbox");
    writeFileSync(join(outbox, "built.xml"), "<Invoice/>");
    writeFileSync(join(inbox, "given.xml"), "<CreditNote/>");
    symlinkSync(join(inbox, "given.xml"), join(outbox, "planted.xml"));
    const read = withOutbox(inputFilesWith([inbox]), outbox);
    expect((await read({ path: join(outbox, "built.xml") })).bytes.toString()).toBe("<Invoice/>");
    expect((await read({ path: "given.xml" })).bytes.toString()).toBe("<CreditNote/>");
    await expect(read({ path: join(outbox, "planted.xml") })).rejects.toMatchObject({ error: { code: "symlink" } });
    expect(read.where).toContain("outbox");
  });
});

describe("build_invoice, then validate_invoice and upload_invoice by the path it answered", () => {
  it("hands the exact bytes on, through the guard", async () => {
    const base = fakeDeps();
    mkdirSync(base.paths.downloadsDir, { recursive: true });
    const sent: UploadQuery[] = [];
    const validated: string[] = [];
    const deps: Deps = {
      ...base,
      files: makeFiles(withOutbox(inputFilesWith([]), base.paths.downloadsDir)),
      anaf: anafStub({
        validate: async (xml) => (validated.push(xml), { stare: "ok", trace_id: "t" }),
        uploadInvoice: async (q) => (sent.push(q), { header: { executionStatus: 0, indexIncarcare: 5001 }, raw: '<header ExecutionStatus="0" index_incarcare="5001"/>' }),
      }),
    };
    const server = new McpServer({ name: "anaf-efactura", version: "test" });
    registerAll(guard(server, { service: "anaf-efactura", policy: POLICY, log: () => undefined }), deps);
    const client = await connectInMemory(server);
    type Result = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;

    const build = await call("build_invoice", BUILD_CASES["ron-standard"] as unknown as BuildArgs);
    expect(build.isError).toBeFalsy();
    expect(build.structuredContent).toEqual(JSON.parse(build.content[0]?.text ?? "{}"));
    const { path, sha256 } = build.structuredContent as { path: string; sha256: string };

    const validation = await call("validate_invoice", { xml: { path } });
    expect(JSON.parse(validation.content[0]?.text ?? "{}")).toMatchObject({ valid: true, file: { sha256 } });
    expect(sha256Of(Buffer.from(validated[0] ?? "", "utf8"))).toBe(sha256);

    // upload_invoice reads its file in the policy, before anyone is asked, with the service's reader.
    vi.stubEnv("ANAF_DOWNLOADS_DIR", base.paths.downloadsDir);
    const upload = await call("upload_invoice", { xml: { path }, test: true });
    expect(JSON.parse(upload.content[0]?.text ?? "{}")).toMatchObject({ ok: true, environment: "test", sha256, invoice: { payable: "3026.10" } });
    expect(sha256Of(sent[0]?.xml ?? Buffer.alloc(0))).toBe(sha256);
  });
});
