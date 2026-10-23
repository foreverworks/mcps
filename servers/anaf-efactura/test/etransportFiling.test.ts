/**
 * etransport_file and etransport_status: a transport declaration (ANAF's
 * schema v2) read, held to its check digits, confirmed on one line and filed
 * through the ledger, against a stubbed ANAF. The declarations are invented;
 * their shape is ANAF's own v2 example (upload_param.html) and the UITs are
 * the samples in ANAF's schematron (eTransport-validation_v.2.0.2).
 */
import { createHash } from "node:crypto";

import { connectInMemory, guard, McpServer, sha256Of } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { filingConfirmationLine, fileTransport, transportStatusOf } from "../src/app/usecases/transports.js";
import { uitProblem } from "../src/domain/etransportFiling.js";
import { apiError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { makeAnafApi } from "../src/infra/anafApi.js";
import { ANAF } from "../src/infra/config.js";
import { makePublicRequest, makeRequest } from "../src/infra/http.js";
import { readDeclarationXml } from "../src/infra/xml.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { anafStub, errorOf, fakeDeps, json, memoryLedger, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const UIT = "8H0Q0V0L0Q3WQN41";

const declaration = (body: string, root = 'codDeclarant="92345672" refDeclarant="REF-1"') => `<?xml version="1.0" encoding="UTF-8"?>
<eTransport xmlns="mfp:anaf:dgti:eTransport:declaratie:v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${root}>
${body}
</eTransport>`;

const NOTIFICARE = (inner = "") => `  <notificare codTipOperatiune="30">${inner}
    <bunuriTransportate codTarifar="0202" denumireMarfa="Carne de vita" codScopOperatiune="101" cantitate="50.5" codUnitateMasura="KGM" greutateNeta="50.5" greutateBruta="52" valoareLeiFaraTva="1500.50"/>
    <bunuriTransportate denumireMarfa="Ambalaje" codScopOperatiune="101" cantitate="10" codUnitateMasura="H87" greutateBruta="5" valoareLeiFaraTva="300"/>
    <partenerComercial codTara="RO" cod="87654329" denumire="Client Exemplu SRL"/>
    <dateTransport nrVehicul="CJ12ABC" nrRemorca1="CJ34DEF" codTaraOrgTransport="RO" codOrgTransport="92345672" denumireOrgTransport="Exemplu Transport SRL" dataTransport="2026-10-23"/>
    <locStartTraseuRutier><locatie codJudet="12" denumireLocalitate="Cluj-Napoca" denumireStrada="Strada Exemplului"/></locStartTraseuRutier>
    <locFinalTraseuRutier><locatie codJudet="22" denumireLocalitate="Iasi" denumireStrada="Strada Clientului"/></locFinalTraseuRutier>
    <documenteTransport tipDocument="30" numarDocument="EXS-2026-0101" dataDocument="2026-10-22"/>
  </notificare>`;

const NEW = declaration(NOTIFICARE());
const CORRECTION = declaration(NOTIFICARE(`\n    <corectie uit="${UIT}"/>`));
const DELETION = declaration(`  <stergere uit="${UIT}"/>`);
const CONFIRMATION = declaration(`  <confirmare uit="${UIT}" tipConfirmare="20" observatii="2 of 3 pallets"/>`);
const VEHICLE = declaration(`  <modifVehicul uit="${UIT}" nrVehicul="B99XYZ" dataModificare="2026-10-23T10:00:00"/>`);
const EXPORT = declaration(
  NOTIFICARE()
    .replace('codTipOperatiune="30"', 'codTipOperatiune="50"')
    .replace(/<locFinalTraseuRutier>.*<\/locFinalTraseuRutier>/, '<locFinalTraseuRutier codBirouVamal="402801"/>'),
);

const read = (xml: string) => {
  const reading = readDeclarationXml(xml);
  if (reading.kind !== "declaration") throw new Error(reading.why);
  return reading.declaration;
};

const line = (xml: string, over: { test?: boolean; cif?: string; refile?: boolean } = {}) =>
  filingConfirmationLine(readDeclarationXml, { xml, cif: over.cif ?? "", test: over.test ?? true, refile: over.refile });

const sha12 = (xml: string) => createHash("sha256").update(xml).digest("hex").slice(0, 12);

describe("reading a declaration", () => {
  it("reads a new transport: route, vehicle, partner, carrier, and the goods' value summed exactly", () => {
    expect(read(NEW)).toEqual({
      operation: "declaration",
      declarant: "92345672",
      reference: "REF-1",
      afterOutage: false,
      uit: undefined,
      operationType: "30",
      confirmation: undefined,
      from: { kind: "address", county: "12", locality: "Cluj-Napoca", street: "Strada Exemplului" },
      to: { kind: "address", county: "22", locality: "Iasi", street: "Strada Clientului" },
      vehicle: { plate: "CJ12ABC", trailer1: "CJ34DEF", trailer2: undefined },
      transportDate: "2026-10-23",
      partner: { country: "RO", code: "87654329", name: "Client Exemplu SRL" },
      carrier: { country: "RO", code: "92345672", name: "Exemplu Transport SRL" },
      goods: { lines: 2, valued: 2, valueRon: "1800.50" },
    });
  });

  it("tells a correction, a deletion, a confirmation and a vehicle change apart, each with its UIT", () => {
    expect(read(CORRECTION)).toMatchObject({ operation: "correction", uit: UIT, goods: { valueRon: "1800.50" } });
    expect(read(DELETION)).toMatchObject({ operation: "deletion", uit: UIT, from: undefined, vehicle: undefined });
    expect(read(CONFIRMATION)).toMatchObject({ operation: "confirmation", uit: UIT, confirmation: "20" });
    expect(read(VEHICLE)).toMatchObject({ operation: "vehicle change", uit: UIT, vehicle: { plate: "B99XYZ" }, transportDate: "2026-10-23T10:00:00" });
    expect(read(EXPORT).to).toEqual({ kind: "customs office", code: "402801" });
  });

  it("refuses what is not one v2 declaration", () => {
    expect(readDeclarationXml(NEW.replace(":v2", ":v1"))).toMatchObject({ kind: "unreadable", why: expect.stringContaining("schema v2") });
    expect(readDeclarationXml(declaration(""))).toMatchObject({ kind: "unreadable", why: expect.stringContaining("holds none") });
    expect(readDeclarationXml(declaration(`  <stergere uit="${UIT}"/>\n  <confirmare uit="${UIT}" tipConfirmare="10"/>`))).toMatchObject({
      kind: "unreadable",
      why: expect.stringContaining("stergere and confirmare"),
    });
    expect(readDeclarationXml(`<Invoice xmlns="mfp:anaf:dgti:eTransport:declaratie:v2"/>`)).toMatchObject({ kind: "unreadable", why: expect.stringContaining("Invoice") });
  });
});

describe("the check digits, before anyone is asked", () => {
  it("passes every sample UIT in ANAF's schematron, and fails a wrong character or one outside a UIT's alphabet", () => {
    for (const sample of ["8H0Q0V0L0Q3WQN41", "9E0P0C0J0J3DQV99", "0C1E0K0N0M3EHP79", "1C1E0Y0Y0N3YLK25", "2D1R0D0L0N3CYH94", "3H1M0A0E0J3FKN75"]) {
      expect(uitProblem(sample)).toBeUndefined();
    }
    // A swap keeps the sum: neither this check nor ANAF's can see it.
    expect(uitProblem("H80Q0V0L0Q3WQN41")).toBeUndefined();
    expect(uitProblem("8H0Q0V0L0Q3WQN42")).toContain("check digits");
    expect(uitProblem("8H0Q0V0L0Q3WQB41")).toContain("alphabet");
  });

  it("refuses a declaration whose declarant code or UIT is wrong, without a call", async () => {
    const spy = vi.fn(anafStub().fileTransport);
    const deps = fakeDeps({ anaf: anafStub({ fileTransport: spy }) });
    const badDeclarant = NEW.replace('codDeclarant="92345672"', 'codDeclarant="92345675"');
    expect(await errorOf(() => fileTransport(deps, { xml: badDeclarant, cif: "", test: true }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("declarant"),
    });
    expect(await errorOf(() => fileTransport(deps, { xml: DELETION.replace(UIT, "8H0Q0V0L0Q3WQN42"), cif: "", test: true }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("check digits"),
    });
    expect(spy).not.toHaveBeenCalled();
    // A person declaring with a CNP is a declarant too.
    expect(await fileTransport(deps, { xml: NEW.replace('codDeclarant="92345672"', 'codDeclarant="1850101990007"'), cif: "", test: true })).toMatchObject({ accepted: true });
  });
});

describe("the line a person confirms", () => {
  it("names the operation, the UIT or new, the route, the vehicle, the goods' value in RON and the environment", () => {
    expect(line(NEW)).toBe(
      `File e-Transport declaration for a new UIT, Cluj-Napoca (county 12) to Iasi (county 22), vehicle CJ12ABC + trailer CJ34DEF, 1800.50 RON, environment test; declarant 92345672, file sha256 ${sha12(NEW)}`,
    );
    expect(line(CORRECTION, { test: false })).toBe(
      `File e-Transport correction for UIT ${UIT}, Cluj-Napoca (county 12) to Iasi (county 22), vehicle CJ12ABC + trailer CJ34DEF, 1800.50 RON, environment prod; declarant 92345672, file sha256 ${sha12(CORRECTION)}`,
    );
    expect(line(EXPORT)).toContain("Cluj-Napoca (county 12) to customs office 402801");
  });

  it("names what a deletion, a confirmation and a vehicle change hold, and only that", () => {
    expect(line(DELETION, { test: false, refile: true })).toBe(
      `File e-Transport deletion for UIT ${UIT}, environment prod; declarant 92345672, AGAIN (refile), file sha256 ${sha12(DELETION)}`,
    );
    expect(line(CONFIRMATION)).toMatch(new RegExp(`^File e-Transport confirmation \\(confirmed in part\\) for UIT ${UIT}, environment test;`));
    expect(line(VEHICLE)).toMatch(new RegExp(`^File e-Transport vehicle change for UIT ${UIT}, vehicle B99XYZ, from 2026-10-23T10:00:00, environment test;`));
  });

  it("says when not every line states its value, and when a file cannot be read", () => {
    const partial = NEW.replace(' valoareLeiFaraTva="300"', "");
    expect(line(partial)).toContain("1500.50 RON (1 of 2 lines valued)");
    expect(line("<nope")).toMatch(/^File e-Transport: UNREADABLE XML/);
  });

  it("is what the policy shows, from the same resolved arguments the call runs on", () => {
    const resolved = { xml: NEW, xml_read: { name: "t.xml", size: Buffer.byteLength(NEW), sha256: sha256Of(Buffer.from(NEW)) }, cif: "", test: false, refile: false };
    const rule = POLICY["etransport_file"];
    expect(rule?.access).toBe("money");
    const summary = rule !== undefined && "summary" in rule ? rule.summary : undefined;
    expect(summary?.(resolved)).toBe(filingConfirmationLine(readDeclarationXml, { xml: NEW, read: resolved.xml_read, cif: "", test: false, refile: false }));
    expect(summary?.(resolved)).toContain("environment prod");
  });
});

describe("fileTransport, the use case", () => {
  it("files the exact bytes in the test environment by default, and answers the uploadId and the UIT", async () => {
    const spy = vi.fn(anafStub().fileTransport);
    const out = await fileTransport(fakeDeps({ anaf: anafStub({ fileTransport: spy }) }), { xml: NEW, cif: "", test: true });
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ cif: "92345672", test: true });
    expect(spy.mock.calls[0]?.[0].xml.toString("utf8")).toBe(NEW);
    expect(out).toMatchObject({
      ok: true,
      environment: "test",
      cif: "92345672",
      sha256: sha256Of(Buffer.from(NEW)),
      accepted: true,
      uploadId: "7001",
      uit: UIT,
      declaration: { operation: "declaration", goods: { valueRon: "1800.50" } },
    });
  });

  it("reads a refusal as not accepted, with ANAF's reasons", async () => {
    const deps = fakeDeps({
      anaf: anafStub({ fileTransport: async () => ({ ExecutionStatus: 1, Errors: [{ errorMessage: "Nu aveti drept in SPV pentru CIF=92345672" }], dateResponse: "202610221130" }) }),
    });
    expect(await fileTransport(deps, { xml: NEW, cif: "", test: true })).toMatchObject({ accepted: false, uploadId: undefined, errors: ["Nu aveti drept in SPV pentru CIF=92345672"] });
  });

  it("files the same bytes in production once, through the ledger, and again only with refile", async () => {
    const spy = vi.fn(anafStub().fileTransport);
    const ledger = memoryLedger();
    const deps = fakeDeps({ anaf: anafStub({ fileTransport: spy }), uploads: ledger });
    await fileTransport(deps, { xml: NEW, cif: "", test: false });
    expect(ledger.entries.get(sha256Of(Buffer.from(NEW)))).toMatchObject({ kind: "etransport", outcome: "accepted", uploadId: "7001" });
    expect(await errorOf(() => fileTransport(deps, { xml: NEW, cif: "", test: false }))).toMatchObject({
      kind: "input",
      message: expect.stringContaining("check etransport_status or etransport_list first"),
    });
    await fileTransport(deps, { xml: NEW, cif: "", test: false, refile: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never sends again after a lost answer", async () => {
    const lost = vi.fn(async () => fail(apiError(502, "gateway", { reason: OUTCOME_UNKNOWN })));
    const deps = fakeDeps({ anaf: anafStub({ fileTransport: lost }) });
    expect(await errorOf(() => fileTransport(deps, { xml: DELETION, cif: "", test: false }))).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(await errorOf(() => fileTransport(deps, { xml: DELETION, cif: "", test: false }))).toMatchObject({ message: expect.stringContaining("outcome is unknown") });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it("reads a status into ok, processing or failed", async () => {
    const answers = [
      { stare: "ok", ExecutionStatus: 0 },
      { stare: "in prelucrare", ExecutionStatus: 0 },
      { stare: "nok", ExecutionStatus: 1, Errors: [{ errorMessage: "UIT-ul nu poate fi identificat." }] },
      { stare: "XML cu erori nepreluat de sistem", ExecutionStatus: 0 },
    ];
    const states = [];
    for (const answer of answers) {
      const out = await transportStatusOf(fakeDeps({ anaf: anafStub({ transportStatus: async () => answer }) }), { idIncarcare: "7001", test: true });
      states.push([out.state, out.errors]);
    }
    expect(states).toEqual([
      ["ok", []],
      ["processing", []],
      ["failed", ["UIT-ul nu poate fi identificat."]],
      ["failed", []],
    ]);
    expect(await errorOf(() => transportStatusOf(fakeDeps(), { idIncarcare: "70a1", test: true }))).toMatchObject({ kind: "input" });
  });
});

describe("the adapter", () => {
  const api = () =>
    makeAnafApi(
      async () => ANAF,
      makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined }),
      makePublicRequest({ sleep: async () => undefined }),
    );

  it("POSTs the declaration as XML to /upload/ETRANSP/{cif}/2 and reads ANAF's JSON", async () => {
    const spy = withFetch(async () =>
      json({ dateResponse: "202212231132", ExecutionStatus: 0, index_incarcare: 1, UIT: "A0002", trace_id: "96cd587e", ref_declarant: "", atentie: "Verificati starea XML-ului transmis." }),
    );
    const out = await api().fileTransport({ cif: "92345672", xml: Buffer.from(NEW), test: true });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.etransportTest}/upload/ETRANSP/92345672/2`);
    expect(spy.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get("content-type")).toBe("application/xml");
    expect(out).toMatchObject({ ExecutionStatus: 0, index_incarcare: 1, UIT: "A0002" });
  });

  it("calls a 200 it cannot read OUTCOME_UNKNOWN, because ANAF may have filed it", async () => {
    withFetch(async () => new Response("<html>maintenance</html>"));
    expect(await errorOf(() => api().fileTransport({ cif: "92345672", xml: Buffer.from(NEW), test: false }))).toMatchObject({ kind: "api", reason: OUTCOME_UNKNOWN });
  });

  it("asks /stareMesaj/{id} in the environment given", async () => {
    const spy = withFetch(async () => json({ stare: "ok", dateResponse: "202208021047", ExecutionStatus: 0, trace_id: "366efb31" }));
    expect(await api().transportStatus("7001", false)).toMatchObject({ stare: "ok" });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.etransportProd}/stareMesaj/7001`);
  });
});

describe("etransport_file, through the guard", () => {
  it("is listed as money and files the bytes it was given", async () => {
    const spy = vi.fn(anafStub().fileTransport);
    const server = new McpServer({ name: "anaf-efactura", version: "test" });
    registerAll(guard(server, { service: "anaf-efactura", policy: POLICY, log: () => undefined }), fakeDeps({ anaf: anafStub({ fileTransport: spy }) }));
    const client = await connectInMemory(server);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "etransport_file")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.find((t) => t.name === "etransport_status")?.annotations).toMatchObject({ readOnlyHint: true });
    const bytes = Buffer.from(CONFIRMATION);
    const result = (await client.callTool({ name: "etransport_file", arguments: { xml: { content_base64: bytes.toString("base64"), sha256: sha256Of(bytes) } } })) as {
      content: { text: string }[];
    };
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ ok: true, environment: "test", declaration: { operation: "confirmation" } });
    expect(spy.mock.calls[0]?.[0].xml.equals(bytes)).toBe(true);
  });
});
