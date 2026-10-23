/**
 * The adapter against a stubbed fetch: the URLs and parameter names, and every
 * answer parsed against ANAF's published shapes before anything reads it.
 * The bodies are ANAF's own examples from its OpenAPI documents (openapi/).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { makeAnafApi } from "../src/infra/anafApi.js";
import { ANAF } from "../src/infra/config.js";
import { makePublicRequest, makeRequest } from "../src/infra/http.js";
import { errorOf, json, withFetch } from "./fixtures.js";

afterEach(() => vi.unstubAllGlobals());

const api = () =>
  makeAnafApi(
    async () => ANAF,
    makeRequest({ get: async () => "token", force: async () => "token" }, { sleep: async () => undefined }),
    makePublicRequest({ sleep: async () => undefined }),
  );

const xml = (body: string) => new Response(body, { headers: { "content-type": "application/xml" } });

describe("the e-Factura listings", () => {
  it("call listaMesajeFactura with zile and cif, and parse the envelope", async () => {
    const spy = withFetch(async () =>
      json({
        mesaje: [{ data_creare: "202211011415", cif: "8000000000", id_solicitare: "5001130147", detalii: "x", tip: "ERORI FACTURA", id: "3001293434" }],
        serial: "1234AA456",
        cui: "8000000000",
        titlu: "Lista Mesaje disponibile din ultimele 1 zile",
      }),
    );
    const out = await api().listMessages({ cif: "8000000000", zile: 1, test: false });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.fctelProd}/listaMesajeFactura?zile=1&cif=8000000000`);
    expect(out.mesaje?.[0]?.id).toBe("3001293434");
  });

  it("never echoes the cui, the certificate holder's CNP on a real answer, even when the answer drifts", async () => {
    withFetch(async () => json({ cui: "1000000000001,92345672", mesaje: "not-a-list", serial: "1", titlu: "x" }));
    const error = await errorOf(() => api().listMessages({ cif: "92345672", zile: 1, test: true }));
    expect(error?.kind).toBe("api");
    expect(JSON.stringify(error)).not.toContain("1000000000001");
    expect(JSON.stringify(error)).toContain("not-a-list");
  });

  it("fails loudly, naming the endpoint, when a field changes type", async () => {
    withFetch(async () => json({ mesaje: "not a list" }));
    const error = await errorOf(() => api().listMessages({ cif: "1", zile: 1, test: true }));
    expect(error).toMatchObject({ kind: "api", status: 200 });
    expect(error?.message).toContain(`${ANAF.fctelTest}/listaMesajeFactura`);
  });

  it("parses the paginated envelope with its counters", async () => {
    withFetch(async () => json({ mesaje: [], numar_total_inregistrari: 14130, numar_total_pagini: 29, index_pagina_curenta: 29 }));
    const out = await api().listMessagesPaginated({ cif: "1", startTimeMs: 1, endTimeMs: 2, pagina: 29, test: false });
    expect(out).toMatchObject({ numar_total_pagini: 29, index_pagina_curenta: 29 });
  });
});

describe("e-Transport", () => {
  it("calls /ws/v1/lista/{zile}/{cif} with path parameters, as ANAF documents", async () => {
    const spy = withFetch(async () => json({ mesaje: [], dateResponse: "202210111242", ExecutionStatus: 0, trace_id: "t" }));
    await api().etransportList({ cif: "8000000000", zile: 1, test: false });
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.anaf.ro/prod/ETRANSPORT/ws/v1/lista/1/8000000000");
  });

  it("refuses an answer without the fields the document marks required", async () => {
    withFetch(async () => json({ mesaje: [] }));
    expect(await errorOf(() => api().etransportList({ cif: "1", zile: 1, test: true }))).toMatchObject({ kind: "api" });
  });
});

describe("upload and stareMesaj", () => {
  it("POSTs the XML with standard, cif and only the flags that are set, and reads the header", async () => {
    const spy = withFetch(async () =>
      xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="202108051140" ExecutionStatus="0" index_incarcare="3828"/>',
      ),
    );
    const out = await api().uploadInvoice({
      cif: "8000000000",
      xml: Buffer.from("<Invoice/>"),
      standard: "UBL",
      flags: { extern: true, autofactura: false, executare: false },
      test: true,
      b2c: false,
    });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.fctelTest}/upload?standard=UBL&cif=8000000000&extern=DA`);
    expect(spy.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(out.header).toEqual({ executionStatus: 0, indexIncarcare: 3828, dateResponse: "202108051140" });
  });

  it("sends a B2C invoice to /uploadb2c with the same parameters, and reads the same header", async () => {
    const spy = withFetch(async () => xml('<header ExecutionStatus="0" index_incarcare="3829" dateResponse="202108051141"/>'));
    const out = await api().uploadInvoice({
      cif: "8000000000",
      xml: Buffer.from("<Invoice/>"),
      standard: "UBL",
      flags: { extern: false, autofactura: false, executare: false },
      test: false,
      b2c: true,
    });
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.fctelProd}/uploadb2c?standard=UBL&cif=8000000000`);
    expect(spy.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(out.header).toMatchObject({ executionStatus: 0, indexIncarcare: 3829 });
  });

  it("reads every Errors element of a refusal", async () => {
    withFetch(async () =>
      xml('<header ExecutionStatus="1"><Errors errorMessage="CIF invalid"/><Errors errorMessage="Lipsa linii"/></header>'),
    );
    const out = await api().uploadInvoice({ cif: "1", xml: Buffer.from("<x/>"), standard: "UBL", flags: { extern: false, autofactura: false, executare: false }, test: true, b2c: false });
    expect(out.header.errors).toEqual([{ errorMessage: "CIF invalid" }, { errorMessage: "Lipsa linii" }]);
  });

  it("calls an upload answer it cannot read OUTCOME_UNKNOWN, because ANAF may have filed it", async () => {
    withFetch(async () => new Response("<html>maintenance</html>"));
    const error = await errorOf(() =>
      api().uploadInvoice({ cif: "1", xml: Buffer.from("<x/>"), standard: "UBL", flags: { extern: false, autofactura: false, executare: false }, test: false, b2c: false }),
    );
    expect(error).toMatchObject({ kind: "api", reason: OUTCOME_UNKNOWN });
  });

  it("reads stareMesaj's state and download id", async () => {
    const spy = withFetch(async () => xml('<header xmlns="mfp:anaf:dgti:efactura:stareMesajFactura:v1" stare="ok" id_descarcare="1234"/>'));
    const out = await api().uploadStatus("5001", false);
    expect(String(spy.mock.calls[0]?.[0])).toBe(`${ANAF.fctelProd}/stareMesaj?id_incarcare=5001`);
    expect(out.header).toEqual({ stare: "ok", idDescarcare: "1234" });
  });
});

describe("descarcare", () => {
  it("hands back an archive untouched", async () => {
    withFetch(async () => new Response(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01])));
    expect(await api().downloadMessage("1", false)).toMatchObject({ refusal: undefined });
  });

  it("reads ANAF's JSON refusal when the answer is not an archive", async () => {
    withFetch(async () => json({ eroare: "Nu aveti dreptul sa descarcati acesta factura", titlu: "Descarcare mesaj" }));
    const out = await api().downloadMessage("1", false);
    expect(out.refusal?.eroare).toContain("Nu aveti dreptul");
  });
});
