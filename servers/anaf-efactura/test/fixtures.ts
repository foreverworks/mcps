/**
 * What the tests share. Every directory is a fresh temp dir and every network
 * answer a stub: nothing here points at a real grant, and the kit's isolation
 * (packages/mcp-kit/testing/isolate.ts) refuses any fetch that was not stubbed.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { inputFilesWith, sha256Of } from "@foreverworks/mcp-kit";
import { vi } from "vitest";

import type { AnafPort, AuthorizationPort, Deps, TokensPort, UploadLedgerPort } from "../src/app/ports.js";
import type { DocumentInput } from "../src/app/usecases/inputFiles.js";
import { type LedgerEntry, refileProblem } from "../src/domain/uploadLedger.js";
import { asAppError } from "../src/domain/errors.js";
import type { TokenBundle } from "../src/domain/tokens.js";
import { readDeclarationXml, readInvoiceXml, viewInvoiceXml } from "../src/infra/xml.js";
import { readZip } from "../src/infra/zip.js";

export const NOW = 1_800_000_000;
export const DAY = 86_400;

export const tempDir = (label: string): string => mkdtempSync(join(tmpdir(), `anaf-${label}-`));

export const bundle = (over: Partial<TokenBundle> = {}): TokenBundle => ({
  accessToken: "old-access",
  refreshToken: "old-refresh",
  tokenType: "Bearer",
  expiresIn: 90 * DAY,
  scope: "clientappid issuer role serial",
  obtainedAtEpoch: NOW - DAY,
  accessTokenExpEpoch: NOW + 80 * DAY,
  refreshTokenExpEpoch: NOW + 300 * DAY,
  serial: "serial",
  issuer: "issuer",
  roles: "EFACTURA",
  ...over,
});

export const errorOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

export const kindOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown)?.kind;
  }
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Replaces fetch for one test; the file's afterEach restores the kit's refusing one. */
export const withFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
};

const b64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A token shaped like ANAF's JWT (unsigned: nothing here verifies it, on purpose). */
export const jwt = (claims: Readonly<Record<string, unknown>>): string =>
  `${b64url({ alg: "RS512", kid: "test" })}.${b64url(claims)}.signature`;

export const APP = {
  app_name: "test-app",
  client_id: "client-id-abcd",
  client_secret: "client-secret",
  redirect_uris: ["https://example.test/anaf/callback"],
  company_cif: "RO92345672",
};

/**
 * A deployment in temp dirs, laid out as under systemd: app.json alone in a
 * credentials dir, everything written in a separate state dir.
 */
export const deployment = (app: Readonly<Record<string, unknown>> = APP) => {
  const root = tempDir("deploy");
  const configDir = join(root, "credentials");
  const stateDir = join(root, "state");
  mkdirSync(configDir);
  mkdirSync(stateDir);
  writeFileSync(join(configDir, "app.json"), JSON.stringify(app));
  return {
    configDir,
    stateDir,
    env: { ANAF_CONFIG: join(configDir, "app.json"), ANAF_STATE_DIR: stateDir },
  };
};

export const anafStub = (over: Partial<AnafPort> = {}): AnafPort => ({
  hello: async () => "hello",
  listMessages: async () => ({ mesaje: [] }),
  listMessagesPaginated: async () => ({ mesaje: [] }),
  downloadMessage: async () => ({ bytes: ARCHIVE, refusal: undefined }),
  uploadInvoice: async () => ({
    header: { executionStatus: 0, indexIncarcare: 5001, dateResponse: "202601151234" },
    raw: '<header ExecutionStatus="0" index_incarcare="5001" dateResponse="202601151234"/>',
  }),
  uploadStatus: async () => ({ header: { stare: "ok", idDescarcare: "3001" }, raw: '<header stare="ok" id_descarcare="3001"/>' }),
  etransportList: async () => ({ dateResponse: "202601151234", ExecutionStatus: 0, trace_id: "t" }),
  fileTransport: async () => ({ dateResponse: "202610221130", ExecutionStatus: 0, index_incarcare: 7001, UIT: "8H0Q0V0L0Q3WQN41", trace_id: "t", ref_declarant: "" }),
  transportStatus: async () => ({ stare: "ok", dateResponse: "202610221131", ExecutionStatus: 0, trace_id: "t" }),
  validate: async () => ({ stare: "ok", trace_id: "t" }),
  convert: async () => ({ pdf: Buffer.from("%PDF-1.5\n") }),
  companies: async () => ({ found: [], notFound: [] }),
  verifySeal: async () => ({ msg: "Fișierele încărcate au fost validate cu succes" }),
  ...over,
});

export const tokensStub = (over: Partial<TokensPort> = {}): TokensPort => ({
  read: async () => bundle(),
  rotate: async () => bundle({ accessToken: "rotated", accessTokenExpEpoch: NOW + 90 * DAY, refreshTokenExpEpoch: NOW + 365 * DAY }),
  replace: async () => undefined,
  ...over,
});

export const authorizationStub = (over: Partial<AuthorizationPort> = {}): AuthorizationPort => ({
  redirectUris: async () => APP.redirect_uris,
  authorizeUrl: async (redirectUri, state) => `https://login.test/authorize?redirect_uri=${redirectUri}&state=${state}`,
  exchangeCode: async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }),
  fromRedirect: () => ({ code: undefined, state: undefined }),
  newState: () => "state-1",
  pending: { read: async () => undefined, write: async () => undefined, clear: async () => undefined },
  ...over,
});

/** Use-case deps over fakes, with every path in a fresh temp dir. */
/** A Romanian fiscal code made valid by its control digit: invented, never anyone's on purpose. */
export const validCif = (body: string): string => {
  const padded = body.padStart(9, "0");
  const sum = [...padded].reduce((s, d, i) => s + Number(d) * Number("753217532"[i]), 0);
  return `${body}${((sum * 10) % 11) % 10}`;
};

/** A document as a script sends it: its bytes as base64, with their sha256. */
export const sent = (name: string, content: string | Buffer): DocumentInput => {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return { name, source: { contentBase64: bytes.toString("base64"), sha256: sha256Of(bytes) } };
};

/** A document by path in the reader's roots. */
export const byPath = (name: string, path: string): DocumentInput => ({ name, source: { path } });

/** A document argument the caller left out. */
export const absent = (name: string): DocumentInput => ({ name });

/** The upload ledger in memory, with what it holds for a test to read. */
export const memoryLedger = (): UploadLedgerPort & { readonly entries: Map<string, LedgerEntry> } => {
  const entries = new Map<string, LedgerEntry>();
  return {
    entries,
    find: async (sha256) => entries.get(sha256),
    reserve: async (entry, refile) => {
      const problem = refileProblem(entries.get(entry.sha256), refile);
      if (problem !== undefined) return { ok: false, problem };
      entries.set(entry.sha256, { ...entry, outcome: "sent" });
      return { ok: true };
    },
    record: async (entry) => {
      entries.set(entry.sha256, entry);
    },
  };
};

export const fakeDeps = (over: Partial<Deps> = {}): Deps => {
  const stateDir = tempDir("state");
  return {
    anaf: anafStub(),
    tokens: tokensStub(),
    authorization: authorizationStub(),
    // The kit's real reader, with no roots: a path is refused unless a test gives it an inbox.
    files: { writeFile: async (dir, name) => join(dir, name), readFile: async () => Buffer.alloc(0), readInput: inputFilesWith([]) },
    uploads: memoryLedger(),
    paths: {
      config: join(tempDir("credentials"), "app.json"),
      tokens: join(stateDir, "tokens.json"),
      stateDir,
      downloadsDir: join(stateDir, "invoices"),
    },
    identity: async () => ({ appName: "app", clientIdLast4: "abcd", defaultCif: "RO92345672" }),
    readInvoice: readInvoiceXml,
    viewInvoice: viewInvoiceXml,
    readDeclaration: readDeclarationXml,
    unzip: readZip,
    checkSeal: () => ({ verdict: "inconclusive", reason: "no seal checker in this test" }),
    now: () => NOW,
    ...over,
  };
};

export const UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>EX-0042</cbc:ID>
  <cbc:IssueDate>2026-09-28</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>RO92345672</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu SRL</cbc:RegistrationName><cbc:CompanyID>J99/1/2020</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>Acme Trading</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>ACME &amp; Sons SRL</cbc:RegistrationName><cbc:CompanyID>87654329</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>RO49AAAA1B31007593840000</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">1037.39</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="RON">1234.50</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

export const UBL_CREDIT_NOTE = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EX-CN-7</cbc:ID>
  <cbc:IssueDate>2026-09-29</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>RO92345672</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Exemplu SRL</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>DE123456749</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">100.10</cbc:PayableAmount></cac:LegalMonetaryTotal>
</CreditNote>`;

export const CII_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>CII-9</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260930</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Exemplu SRL</ram:Name>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">92345672</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">RO92345672</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Client SRL</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID>11223344</ram:ID></ram:SpecifiedLegalOrganization>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>RON</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:DuePayableAmount>0.10</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

/**
 * A ZIP laid out as the format says (local headers, central directory, end
 * record), stored or deflated per entry: what ANAF's archives look like, built
 * here so the reader is tested against bytes nobody hand-edited.
 */
export const zipOf = (entries: readonly { readonly name: string; readonly data: Buffer; readonly deflate?: boolean }[]): Buffer => {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = entry.deflate === false ? entry.data : deflateRawSync(entry.data);
    const method = entry.deflate === false ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    directory.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
};

/** A message's archive as ANAF serves one: the invoice and a seal on it (not a real one: checkSeal decides). */
export const ARCHIVE = zipOf([
  { name: "5001.xml", data: Buffer.from(UBL_INVOICE, "utf8") },
  { name: "semnatura_5001.xml", data: Buffer.from("<Signature/>") },
]);

/**
 * One company as PlatitorTvaRest v9 answers it (a list of VAT periods, the
 * e-Factura registry date), with invented values.
 */
export const rawCompany = (over: Readonly<Record<string, unknown>> = {}) => ({
  date_generale: {
    data: "2026-09-30",
    cui: 92345672,
    denumire: "EXEMPLU DISTRIBUTIE SRL",
    adresa: "MUNICIPIUL BUCUREŞTI, SECTOR 1, STR. EXEMPLU, NR.1",
    telefon: "",
    fax: "",
    codPostal: "010101",
    act: "",
    stare_inregistrare: "INREGISTRAT din data 01.01.2020",
    data_inreg_Reg_RO_e_Factura: "2024-01-01",
    organFiscalCompetent: "Administraţia Sector 1 a Finanţelor Publice",
    forma_de_proprietate: "PROPR.PRIVATA-CAPITAL PRIVAT AUTOHTON",
    forma_organizare: "PERSOANA JURIDICA",
    forma_juridica: "SOCIETATE COMERCIALĂ CU RĂSPUNDERE LIMITATĂ",
    statusRO_e_Factura: true,
    data_inregistrare: "2020-01-01",
    nrRegCom: "J99/1/2020",
    cod_CAEN: "6201",
    iban: "",
  },
  inregistrare_scop_Tva: {
    scpTVA: true,
    perioade_TVA: [
      { data_inceput_ScpTVA: "2020-01-01", data_sfarsit_ScpTVA: "2021-12-31", data_anul_imp_ScpTVA: "2022-01-01", mesaj_ScpTVA: "Anulare" },
      { data_inceput_ScpTVA: "2023-01-01", data_sfarsit_ScpTVA: "", data_anul_imp_ScpTVA: "", mesaj_ScpTVA: "" },
    ],
  },
  inregistrare_RTVAI: { dataInceputTvaInc: "", dataSfarsitTvaInc: "", tipActTvaInc: "", statusTvaIncasare: false },
  stare_inactiv: { dataInactivare: "", dataReactivare: "", dataPublicare: "", dataRadiere: "", statusInactivi: false },
  inregistrare_SplitTVA: { dataInceputSplitTVA: "", dataAnulareSplitTVA: "", statusSplitTVA: false },
  adresa_sediu_social: {
    sdenumire_Localitate: "Sector 1 Mun. Bucureşti",
    sdenumire_Strada: "Str. Exemplu",
    snumar_Strada: "1",
    scod_Localitate: "",
    sdenumire_Judet: "MUNICIPIUL BUCUREŞTI",
    scod_Judet: "40",
    scod_JudetAuto: "B",
    sdetalii_Adresa: "",
    scod_Postal: "010101",
    stara: "",
  },
  ...over,
});
