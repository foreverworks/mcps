/**
 * Validation, PDF and the VAT registry: the pure rules, the ZIP reader, the
 * use cases over fake ports, and the adapter against a stubbed fetch. The
 * answers follow ANAF's own shape, from its OpenAPI examples
 * (openapi/efactura-validare.json, openapi/efactura-transformare.json).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inputFilesWith, sha256Of } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupCompanies } from "../src/app/usecases/companies.js";
import { invoicePdf, validateInvoice } from "../src/app/usecases/documents.js";
import { bucharestDate, companyListing, companyOf, parseAsOf, parseCifs } from "../src/domain/company.js";
import type { RawCompany } from "../src/domain/schema.js";
import { findingOf, looksLikePdf, pdfName, validationTarget, verdictOf } from "../src/domain/validation.js";
import { makeAnafApi } from "../src/infra/anafApi.js";
import { ANAF, ANAF_PUBLIC } from "../src/infra/config.js";
import { makePublicRequest, makeRequest } from "../src/infra/http.js";
import { readInvoiceXml } from "../src/infra/xml.js";
import { readZip } from "../src/infra/zip.js";
import {
  absent,
  anafStub,
  byPath,
  CII_INVOICE,
  errorOf,
  fakeDeps,
  json,
  kindOf,
  NOW,
  rawCompany,
  sent,
  UBL_CREDIT_NOTE,
  validCif,
  UBL_INVOICE,
  withFetch,
  zipOf,
} from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const SCHEMATRON =
  "tipAssert=FailedAssert; codEroare=BR-RO-001; localizareEroare=/Invoice; textEroare=[BR-RO-001]-Identificatorul specificatie (BT-24) trebuie sa corespunda sintactic";
const SAX =
  "Fisierul transmis nu este valid. org.xml.sax.SAXParseException; lineNumber: 14; columnNumber: 239; cvc-elt.1.a: Cannot find the declaration of element 'Invoice'.";

describe("ANAF's findings", () => {
  it("reads a Schematron rule, its location and its text without the repeated rule id", () => {
    expect(findingOf(SCHEMATRON)).toEqual({
      rule: "BR-RO-001",
      location: "/Invoice",
      text: "Identificatorul specificatie (BT-24) trebuie sa corespunda sintactic",
    });
  });

  it("reads ANAF's own checks, which name a code and no location", () => {
    expect(findingOf("tipAssert=E; codEroare=ERRIdentif; textEroare=CUI cumparator incorect")).toEqual({
      rule: "ERRIdentif",
      text: "CUI cumparator incorect",
    });
  });

  it("reads a schema error's line and column", () => {
    expect(findingOf(SAX)).toEqual({
      location: "line 14, column 239",
      text: "Fisierul transmis nu este valid. cvc-elt.1.a: Cannot find the declaration of element 'Invoice'.",
    });
  });

  it("reads the older Schematron form from ANAF's examples, and keeps anything else whole", () => {
    expect(findingOf("E: validari globale  SCHEMATRON   eroare: [BR-CO-09]-The Seller VAT identifier")).toEqual({
      rule: "BR-CO-09",
      text: "The Seller VAT identifier",
    });
    expect(findingOf("Marime fisier transmis mai mare de 5 MB.")).toEqual({ text: "Marime fisier transmis mai mare de 5 MB." });
  });

  it("counts only stare ok as valid", () => {
    expect(verdictOf({ stare: "ok", trace_id: "t" })).toEqual({ valid: true, findings: [], traceId: "t" });
    expect(verdictOf({ stare: "nok", trace_id: "t", Messages: [{ message: SCHEMATRON }, { message: " " }, {}] })).toMatchObject({
      valid: false,
      findings: [{ rule: "BR-RO-001" }],
    });
    expect(verdictOf({ stare: "maybe", trace_id: "t" }).valid).toBe(false);
  });
});

describe("the standard a document is", () => {
  it("is FACT1 for a UBL invoice and FCN for a UBL credit note, read from the document", () => {
    expect(validationTarget(readInvoiceXml(UBL_INVOICE))).toMatchObject({ standard: "FACT1", facts: { number: "EX-0042" } });
    expect(validationTarget(readInvoiceXml(UBL_CREDIT_NOTE))).toMatchObject({ standard: "FCN", facts: { number: "EX-CN-7" } });
  });

  it("refuses CII and anything that is not an invoice, as input", () => {
    expect(kindOf(() => validationTarget(readInvoiceXml(CII_INVOICE)))).toBe("input");
    expect(kindOf(() => validationTarget(readInvoiceXml("<Order/>")))).toBe("input");
  });

  it("names a PDF safely, and knows one when it sees it", () => {
    expect(pdfName("EX 2026/0001")).toBe("EX_2026_0001.pdf");
    expect(pdfName("3001293434")).toBe("3001293434.pdf");
    expect(kindOf(() => pdfName("///"))).toBe("input");
    expect(looksLikePdf(Buffer.from("%PDF-1.5\n"))).toBe(true);
    expect(looksLikePdf(Buffer.from('{"stare":"nok"}'))).toBe(false);
  });
});

describe("readZip", () => {
  const invoice = Buffer.from(UBL_INVOICE, "utf8");
  const seal = Buffer.from("<Signature/>", "utf8");

  it("reads stored and deflated entries", () => {
    const entries = readZip(zipOf([{ name: "5001.xml", data: invoice }, { name: "semnatura_5001.xml", data: seal, deflate: false }]));
    expect(entries.map((e) => e.name)).toEqual(["5001.xml", "semnatura_5001.xml"]);
    expect(entries[0]?.data.equals(invoice)).toBe(true);
    expect(entries[1]?.data.equals(seal)).toBe(true);
  });

  it("refuses an archive whose entry fails its checksum", () => {
    const zip = zipOf([{ name: "5001.xml", data: Buffer.from("abcdef"), deflate: false }]);
    zip[30 + "5001.xml".length] = "z".charCodeAt(0);
    expect(kindOf(() => readZip(zip))).toBe("api");
  });

  it("refuses bytes that are not a ZIP at all", () => {
    expect(kindOf(() => readZip(Buffer.from('{"eroare":"no"}')))).toBe("api");
  });
});

describe("validateInvoice", () => {
  it("asks ANAF with the document's own standard and says which invoice the verdict is about", async () => {
    const validate = vi.fn(async () => ({ stare: "nok", trace_id: "t", Messages: [{ message: SCHEMATRON }] }));
    const out = await validateInvoice(fakeDeps({ anaf: anafStub({ validate }) }), { xml: sent("xml", UBL_CREDIT_NOTE) });
    expect(validate).toHaveBeenCalledWith(UBL_CREDIT_NOTE, "FCN");
    expect(out).toMatchObject({ valid: false, standard: "FCN", traceId: "t", invoice: { number: "EX-CN-7" }, findings: [{ rule: "BR-RO-001" }] });
  });

  it("refuses what ANAF would refuse anyway, before asking", async () => {
    const validate = vi.fn(anafStub().validate);
    const deps = fakeDeps({ anaf: anafStub({ validate }) });
    expect(await errorOf(() => validateInvoice(deps, { xml: sent("xml", CII_INVOICE) }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => validateInvoice(deps, { xml: sent("xml", "x".repeat(5 * 1024 * 1024 + 1)) }))).toMatchObject({ kind: "input" });
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("validateInvoice from a file in the inbox", () => {
  it("sends ANAF exactly the file's text, says which file it was, and refuses a call without one", async () => {
    const inbox = mkdtempSync(join(tmpdir(), "anaf-inbox-"));
    writeFileSync(join(inbox, "cn.xml"), UBL_CREDIT_NOTE);
    const validate = vi.fn(async () => ({ stare: "ok", trace_id: "t", Messages: [] }));
    const deps = { ...fakeDeps({ anaf: anafStub({ validate }) }) };
    const withInbox = { ...deps, files: { ...deps.files, readInput: inputFilesWith([inbox]) } };
    expect(await validateInvoice(withInbox, { xml: byPath("xml", "cn.xml") })).toMatchObject({
      valid: true,
      standard: "FCN",
      file: { name: "cn.xml", size: Buffer.byteLength(UBL_CREDIT_NOTE), sha256: sha256Of(Buffer.from(UBL_CREDIT_NOTE)) },
    });
    expect(validate).toHaveBeenCalledWith(UBL_CREDIT_NOTE, "FCN");
    expect(await errorOf(() => validateInvoice(withInbox, { xml: absent("xml") }))).toMatchObject({ kind: "input" });
  });
});

describe("invoicePdf", () => {
  const archive = zipOf([
    { name: "4001.xml", data: Buffer.from(UBL_INVOICE, "utf8") },
    { name: "semnatura_4001.xml", data: Buffer.from("<Signature/>") },
  ]);
  const args = { messageId: "", xml: absent("xml"), validate: true, saveDir: "", test: false };

  it("converts a filed invoice from its archive, without validating it again, as <message id>.pdf", async () => {
    const convert = vi.fn(anafStub().convert);
    const writeFile = vi.fn(async (dir: string, name: string) => join(dir, name));
    const deps = fakeDeps({
      anaf: anafStub({ downloadMessage: async () => ({ bytes: archive, refusal: undefined }), convert }),
      files: { ...fakeDeps().files, writeFile },
    });
    const out = await invoicePdf(deps, { ...args, messageId: "3001293434", saveDir: "2026-09" });
    expect(convert).toHaveBeenCalledWith(UBL_INVOICE, "FACT1", false);
    expect(out).toMatchObject({
      saved: true,
      path: join(deps.paths.downloadsDir, "2026-09", "3001293434.pdf"),
      validated: false,
      invoice: { number: "EX-0042" },
    });
  });

  it("validates a document first, and names the file after the invoice", async () => {
    const convert = vi.fn(anafStub().convert);
    const deps = fakeDeps({ anaf: anafStub({ convert }) });
    expect(await invoicePdf(deps, { ...args, xml: sent("xml", UBL_INVOICE) })).toMatchObject({
      saved: true,
      validated: true,
      path: expect.stringMatching(/EX-0042\.pdf$/),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      md5: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(convert).toHaveBeenCalledWith(UBL_INVOICE, "FACT1", true);
  });

  it("saves nothing and says why when ANAF will not convert", async () => {
    const writeFile = vi.fn(async (dir: string, name: string) => join(dir, name));
    const deps = fakeDeps({
      anaf: anafStub({ convert: async () => ({ refusal: { stare: "nok", trace_id: "t", Messages: [{ message: SCHEMATRON }] } }) }),
      files: { ...fakeDeps().files, writeFile },
    });
    expect(await invoicePdf(deps, { ...args, xml: sent("xml", UBL_INVOICE) })).toMatchObject({ saved: false, valid: false, findings: [{ rule: "BR-RO-001" }] });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("takes exactly one source, and refuses a folder outside the outbox before downloading", async () => {
    const downloadMessage = vi.fn(anafStub().downloadMessage);
    const deps = fakeDeps({ anaf: anafStub({ downloadMessage }) });
    expect(await errorOf(() => invoicePdf(deps, args))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => invoicePdf(deps, { ...args, messageId: "1", xml: sent("xml", UBL_INVOICE) }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => invoicePdf(deps, { ...args, messageId: "FCT 1" }))).toMatchObject({ kind: "input" });
    expect(await errorOf(() => invoicePdf(deps, { ...args, messageId: "1", saveDir: "/etc" }))).toMatchObject({ kind: "input" });
    expect(downloadMessage).not.toHaveBeenCalled();
  });

  it("refuses an archive that does not hold exactly one invoice", async () => {
    const onlySeal = zipOf([{ name: "semnatura_4001.xml", data: Buffer.from("<Signature/>") }]);
    const deps = fakeDeps({ anaf: anafStub({ downloadMessage: async () => ({ bytes: onlySeal, refusal: undefined }) }) });
    expect(await errorOf(() => invoicePdf(deps, { ...args, messageId: "4001" }))).toMatchObject({ kind: "api" });
  });
});

describe("the VAT registry, as data", () => {
  it("maps a company to the statuses an invoice depends on, with the current VAT period", () => {
    expect(companyOf(rawCompany() as RawCompany)).toEqual({
      cif: "92345672",
      name: "EXEMPLU DISTRIBUTIE SRL",
      asOf: "2026-09-30",
      tradeRegister: "J99/1/2020",
      registration: "INREGISTRAT din data 01.01.2020",
      registeredOn: "2020-01-01",
      legalForm: "SOCIETATE COMERCIALĂ CU RĂSPUNDERE LIMITATĂ",
      caen: "6201",
      fiscalOffice: "Administraţia Sector 1 a Finanţelor Publice",
      address: "MUNICIPIUL BUCUREŞTI, SECTOR 1, STR. EXEMPLU, NR.1",
      registeredOffice: {
        street: "Str. Exemplu",
        number: "1",
        locality: "Sector 1 Mun. Bucureşti",
        county: "MUNICIPIUL BUCUREŞTI",
        countyCode: "B",
        postalCode: "010101",
      },
      vatPayer: true,
      vatPeriod: { from: "2023-01-01" },
      vatOnCollection: false,
      splitVat: false,
      inactive: false,
      eFacturaRegistry: true,
      eFacturaRegistrySince: "2024-01-01",
    });
  });

  it("dates an inactive company, and leaves out what ANAF did not send or sent as null", () => {
    const inactive = companyOf({
      date_generale: { cui: 1, cod_CAEN: null, statusRO_e_Factura: null },
      stare_inactiv: { statusInactivi: true, dataInactivare: "2025-03-10", dataRadiere: "" },
    });
    expect(inactive).toEqual({ cif: "1", inactive: true, inactiveSince: "2025-03-10" });
  });

  it("answers in the order asked and names the CIFs ANAF does not know", () => {
    const found = [rawCompany() as RawCompany, { date_generale: { cui: 42 } }];
    expect(companyListing({ found, notFound: [7] }, ["42", "7", "92345672"])).toMatchObject({
      companies: [{ cif: "42" }, { cif: "92345672" }],
      notFound: ["7"],
    });
  });

  it("normalises the CIFs as the registry writes them, once each", () => {
    expect(parseCifs(["RO92345672", "92345672", " 0043 "])).toEqual(["92345672", "43"]);
    expect(kindOf(() => parseCifs([]))).toBe("input");
    expect(parseCifs(Array.from({ length: 100 }, (_, i) => validCif(String(i + 10))))).toHaveLength(100);
    expect(kindOf(() => parseCifs(Array.from({ length: 101 }, (_, i) => validCif(String(i + 10)))))).toBe("input");
    expect(kindOf(() => parseCifs(["12345678"]))).toBe("input");
    expect(kindOf(() => parseCifs(["ACME"]))).toBe("input");
  });

  it("asks as of today in Bucharest, which is tomorrow in UTC late at night", () => {
    const lateUtc = Date.parse("2026-09-30T22:30:00Z") / 1000;
    expect(bucharestDate(lateUtc)).toBe("2026-10-01");
    expect(parseAsOf("", lateUtc)).toBe("2026-10-01");
    expect(parseAsOf("2024-02-29", lateUtc)).toBe("2024-02-29");
    expect(kindOf(() => parseAsOf("2026-02-30", lateUtc))).toBe("input");
  });

  it("lookupCompanies passes the normalised CIFs and the date through", async () => {
    const companies = vi.fn(async () => ({ found: [rawCompany() as RawCompany], notFound: [] }));
    const out = await lookupCompanies(fakeDeps({ anaf: anafStub({ companies }) }), { cifs: ["RO92345672"], date: "" });
    expect(companies).toHaveBeenCalledWith(["92345672"], bucharestDate(NOW));
    expect(out).toMatchObject({ asOf: bucharestDate(NOW), companies: [{ name: "EXEMPLU DISTRIBUTIE SRL" }], notFound: [] });
  });
});

describe("the public services, over the wire", () => {
  const api = () =>
    makeAnafApi(
      async () => ANAF,
      makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined }),
      makePublicRequest({ sleep: async () => undefined }),
    );
  const headersOf = (init: RequestInit | undefined) => new Headers(init?.headers);

  it("validate POSTs the document as text to the public host, with no token", async () => {
    const spy = withFetch(async () => json({ stare: "ok", trace_id: "t" }));
    expect(await api().validate(UBL_INVOICE, "FACT1")).toEqual({ stare: "ok", trace_id: "t" });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${ANAF_PUBLIC.fctel}/validare/FACT1`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(UBL_INVOICE);
    expect(headersOf(init).get("content-type")).toBe("text/plain");
    expect(headersOf(init).get("authorization")).toBeNull();
  });

  it("validate is repeated after a 5xx, because it changes nothing", async () => {
    let calls = 0;
    withFetch(async () => (++calls === 1 ? new Response("down", { status: 503 }) : json({ stare: "ok", trace_id: "t" })));
    expect(await api().validate(UBL_INVOICE, "FACT1")).toMatchObject({ stare: "ok" });
    expect(calls).toBe(2);
  });

  it("convert returns the PDF, asks /DA when told not to validate, and reads a refusal", async () => {
    const pdf = Buffer.from("%PDF-1.5\n7 0 obj");
    const spy = withFetch(async () => new Response(pdf, { headers: { "content-type": "application/pdf" } }));
    expect(await api().convert(UBL_INVOICE, "FACT1", false)).toEqual({ pdf });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF_PUBLIC.fctel}/transformare/FACT1/DA`);

    withFetch(async () => json({ stare: "nok", trace_id: "t", Messages: [{ message: SCHEMATRON }] }));
    expect(await api().convert(UBL_INVOICE, "FCN", true)).toMatchObject({ refusal: { stare: "nok" } });
  });

  it("convert fails loudly on an answer that is neither", async () => {
    withFetch(async () => new Response("<html>maintenance</html>", { headers: { "content-type": "text/html" } }));
    expect(await errorOf(() => api().convert(UBL_INVOICE, "FACT1", true))).toMatchObject({ kind: "api", status: 200 });
  });

  it("companies POSTs numbers and a date, and reads one VAT period as well as a list", async () => {
    const one = rawCompany({ inregistrare_scop_Tva: { scpTVA: true, perioade_TVA: { data_inceput_ScpTVA: "2023-01-01" } } });
    const spy = withFetch(async () => json({ found: [one], notFound: [7] }));
    const out = await api().companies(["92345672", "7"], "2026-09-30");
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe(ANAF_PUBLIC.vatRegistry);
    expect(JSON.parse(String(init?.body))).toEqual([
      { cui: 92345672, data: "2026-09-30" },
      { cui: 7, data: "2026-09-30" },
    ]);
    expect(out.found?.[0]?.inregistrare_scop_Tva?.perioade_TVA).toEqual([{ data_inceput_ScpTVA: "2023-01-01" }]);
    expect(out.notFound).toEqual([7]);
  });
});

describe("a document argument's remedies", () => {
  it("name the arguments that exist: xml as { path } or { content_base64, sha256 }", async () => {
    const error = await errorOf(() => validateInvoice(fakeDeps(), { xml: { name: "xml" } }));
    expect(error?.message).toContain("xml: { path }");
    expect(error?.message).not.toContain("xml_path");
  });
});
