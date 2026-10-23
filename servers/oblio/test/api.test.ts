/**
 * Oblio's HTTP policy and the adapter against a stubbed fetch: what each request
 * looks like on the wire, which failures are repeated and which are not, and
 * how an answer is held against the documented shape.
 */
import { describe, expect, it } from "vitest";

import { authError, DRIFT, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { makeOblioHttp } from "../src/infra/http.js";
import { makeOblioApi } from "../src/infra/oblioApi.js";
import { CIF, envelope, errorOf, invoice, json, withFetch } from "./helpers.js";

/** A clock whose sleeps return at once and move its time on, so no test waits for the throttle. */
const instant = () => {
  const state = { t: 0 };
  return {
    now: () => state.t,
    sleep: async (ms: number) => {
      state.t += ms;
    },
  };
};

type Tokens = { readonly get: () => Promise<string>; readonly force: () => Promise<string> };

/** A token source that hands out "tok", and "tok2" once forced. */
const tokens = (forced: string[] = []): Tokens => {
  const state = { current: "tok" };
  return {
    get: async () => state.current,
    force: async () => {
      forced.push(state.current);
      state.current = "tok2";
      return state.current;
    },
  };
};

const api = (t: Tokens = tokens()) =>
  makeOblioApi(makeOblioHttp(t, { clock: instant(), sleep: async () => undefined }), async () => "https://oblio.test/api");

const ref = { seriesName: "FCT", number: "0042" };

describe("what goes on the wire", () => {
  it("issues an invoice as JSON, with decimals as the strings the caller wrote and the company from app.json", async () => {
    const calls = withFetch(async () => envelope({ seriesName: "FCT", number: "0043", link: "https://oblio.test/pdf" }));
    const draft = invoice({
      issueDate: "2026-09-28",
      products: [{ name: "Consulting", price: "1000.10", quantity: "1.5", vatPercentage: "21", vatIncluded: false, save: false }],
      collect: { type: "Ordin de plata", documentNumber: "OP 7001" },
      idempotencyKey: "k1",
    });
    await expect(api().issueInvoice({ cif: CIF, draft })).resolves.toEqual({
      seriesName: "FCT",
      number: "0043",
      link: "https://oblio.test/pdf",
    });
    expect(calls[0]).toMatchObject({ url: "https://oblio.test/api/docs/invoice", method: "POST" });
    expect(calls[0]?.body).toEqual({
      cif: CIF,
      client: { name: "Client SRL", cif: "RO87654329", vatPayer: 1 },
      issueDate: "2026-09-28",
      seriesName: "FCT",
      precision: 2,
      currency: "RON",
      products: [
        { name: "Consulting", price: "1000.10", quantity: "1.5", vatPercentage: "21", vatIncluded: 0, save: 0 },
      ],
      idempotencyKey: "k1",
      collect: { type: "Ordin de plata", documentNumber: "OP 7001" },
    });
  });

  it("links an invoice to its proforma by reference", async () => {
    const calls = withFetch(async () => envelope({ seriesName: "FCT", number: 44 }));
    const issued = await api().issueInvoiceFromProforma({
      cif: CIF,
      draft: { invoiceSeries: "FCT", proforma: { seriesName: "PR", number: "0007" } },
    });
    expect(issued.number).toBe("44");
    expect(calls[0]?.body).toEqual({
      cif: CIF,
      seriesName: "FCT",
      referenceDocument: { type: "Proforma", seriesName: "PR", number: "0007" },
    });
  });

  it("cancels and restores with PUT and a JSON body, as Oblio's SDK does", async () => {
    const calls = withFetch(async () => envelope({ documentType: "Factura", seriesName: "FCT", number: "0042" }));
    await api().cancelInvoice({ cif: CIF, ref });
    await api().restoreInvoice({ cif: CIF, ref });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["PUT", "https://oblio.test/api/docs/invoice/cancel"],
      ["PUT", "https://oblio.test/api/docs/invoice/restore"],
    ]);
    expect(calls[0]?.body).toEqual({ cif: CIF, seriesName: "FCT", number: "0042" });
  });

  it("deletes with DELETE and a JSON body", async () => {
    const calls = withFetch(async () => envelope({ documentType: "Factura", seriesName: "FCT", number: "0042" }));
    await expect(api().deleteInvoice({ cif: CIF, ref })).resolves.toEqual(ref);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://oblio.test/api/docs/invoice" });
    expect(calls[0]?.body).toEqual({ cif: CIF, seriesName: "FCT", number: "0042" });
  });

  it("reads a document by Oblio's own parameter names, keeping the zero padding", async () => {
    const calls = withFetch(async () => envelope({ seriesName: "FCT", number: "0042" }));
    await api().getInvoice({ cif: CIF, ref });
    expect(calls[0]?.url).toBe(`https://oblio.test/api/docs/invoice?cif=${CIF}&seriesName=FCT&number=0042`);
  });
});

describe("what an answer becomes", () => {
  it("normalises flags, drops empty strings and keeps decimals as text", async () => {
    withFetch(async () =>
      envelope([
        { cif: "RO1", name: "A SRL", rc: "", iban: "", vatPayer: "1", clientId: "9" },
        { name: "Person", vatPayer: false, email: null },
      ]),
    );
    await expect(api().listClients({ cif: CIF, offset: 0 })).resolves.toEqual([
      { name: "A SRL", cif: "RO1", vatPayer: true },
      { name: "Person", vatPayer: false },
    ]);
  });

  it("reads VAT rates by their documented `percent`", async () => {
    withFetch(async () => envelope([{ name: "Normala", percent: 21, default: true }, { name: "Redusa", percent: 9 }]));
    await expect(api().listVatRates({ cif: CIF })).resolves.toEqual([
      { name: "Normala", percent: "21", isDefault: true },
      { name: "Redusa", percent: "9", isDefault: false },
    ]);
  });

  it("keeps a series number as text", async () => {
    withFetch(async () => envelope([{ type: "Factura", name: "FCT", start: "0001", next: "0051", default: true }]));
    await expect(api().listSeries({ cif: CIF })).resolves.toEqual([
      { type: "Factura", name: "FCT", start: "0001", next: "0051", isDefault: true },
    ]);
  });

  it("reads a price as the string Oblio wrote, and a stocked product's stock", async () => {
    withFetch(async () =>
      envelope([
        { name: "Montare", price: "119.00", vatPercentage: 19, vatIncluded: true, productType: "Serviciu" },
        { name: "Birou", stock: [{ management: "Magazin", quantity: 2, price: "200.00", vatIncluded: false }] },
      ]),
    );
    const [service, goods] = await api().listProducts({ cif: CIF, offset: 0 });
    expect(service).toMatchObject({ price: "119.00", vatPercentage: "19", vatIncluded: true });
    expect(goods?.stock).toEqual([{ management: "Magazin", quantity: "2", price: "200.00", vatIncluded: false }]);
  });

  it("fails loudly, as drift, when a documented field changes type", async () => {
    withFetch(async () => envelope([{ type: "Factura", name: 7 }]));
    const error = await errorOf(() => api().listSeries({ cif: CIF }));
    expect(error).toMatchObject({ kind: "api", reason: "drift" });
    expect(error?.message).toContain("nomenclature/series");
  });

  it("fails loudly when a list comes back as something else", async () => {
    withFetch(async () => envelope({ unexpected: true }));
    expect(await errorOf(() => api().listCompanies())).toMatchObject({ reason: "drift" });
  });

  it("refuses an amount too precise to have survived JSON parsing", async () => {
    withFetch(async () => envelope({ seriesName: "FCT", number: "1", total: 12345678901234567 }));
    expect(await errorOf(() => api().getInvoice({ cif: CIF, ref }))).toMatchObject({ reason: "drift" });
  });

  it("carries collects on a document view, their value as text", async () => {
    withFetch(async () =>
      envelope({
        documentType: "Factura",
        seriesName: "FCT",
        number: "0055",
        collects: [{ issueDate: "2018-10-15", type: "Ordin de plata", number: "OP 7001", value: 428.4 }],
      }),
    );
    expect((await api().getInvoice({ cif: CIF, ref })).collects).toEqual([
      { issueDate: "2018-10-15", type: "Ordin de plata", number: "OP 7001", value: "428.4" },
    ]);
  });
});

describe("the retry policy, by what each failure proves", () => {
  it("repeats a throttled request of any kind", async () => {
    let calls = 0;
    withFetch(async () => {
      calls += 1;
      return calls === 1 ? json({ statusMessage: "Too many" }, 429, { "Retry-After": "1" }) : envelope({ seriesName: "FCT", number: "1" });
    });
    await api().issueInvoice({ cif: CIF, draft: invoice() });
    expect(calls).toBe(2);
  });

  it("does NOT repeat an issue whose connection dropped, and says the outcome is unknown", async () => {
    let calls = 0;
    withFetch(async () => {
      calls += 1;
      throw new Error("ECONNRESET");
    });
    const error = await errorOf(() => api().issueInvoice({ cif: CIF, draft: invoice() }));
    expect(calls).toBe(1);
    expect(error).toMatchObject({ kind: "api", reason: OUTCOME_UNKNOWN });
  });

  it("does NOT repeat an issue that met a 5xx", async () => {
    let calls = 0;
    withFetch(async () => {
      calls += 1;
      return new Response("<html>oops</html>", { status: 502 });
    });
    expect(await errorOf(() => api().issueInvoice({ cif: CIF, draft: invoice() }))).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(calls).toBe(1);
  });

  it("calls an HTML page with HTTP 200 drift on a read, and an unknown outcome on an issue", async () => {
    withFetch(async () => new Response("<html>maintenance</html>", { status: 200 }));
    expect(await errorOf(() => api().getInvoice({ cif: CIF, ref }))).toMatchObject({ kind: "api", status: 200, reason: DRIFT });
    expect(await errorOf(() => api().issueInvoice({ cif: CIF, draft: invoice() }))).toMatchObject({ kind: "api", reason: OUTCOME_UNKNOWN });
  });

  it("repeats a read and a cancel after a dropped connection, because repeating them changes nothing", async () => {
    let calls = 0;
    withFetch(async () => {
      calls += 1;
      if (calls % 2 === 1) throw new Error("ECONNRESET");
      return envelope({ seriesName: "FCT", number: "0042" });
    });
    await api().getInvoice({ cif: CIF, ref });
    await api().cancelInvoice({ cif: CIF, ref });
    expect(calls).toBe(4);
  });

  it("refreshes the token once on a 401 and repeats, then believes a second 401", async () => {
    const forced: string[] = [];
    const seen: (string | null)[] = [];
    withFetch(async (_url, init) => {
      seen.push(new Headers(init?.headers).get("authorization"));
      return json({ statusMessage: "Unauthorized" }, 401);
    });
    const error = await errorOf(() => api(tokens(forced)).listCompanies());
    expect(forced).toEqual(["tok"]);
    expect(seen).toEqual(["Bearer tok", "Bearer tok2"]);
    expect(error).toMatchObject({ kind: "api", status: 401 });
  });

  it("leads a refusal with Oblio's own sentence and keeps the body", async () => {
    withFetch(async () => json({ status: 400, statusMessage: "Seria FCT nu exista", data: null }, 400));
    const error = await errorOf(() => api().getInvoice({ cif: CIF, ref }));
    expect(error).toMatchObject({ kind: "api", status: 400, message: "Seria FCT nu exista" });
  });

  it("does not disguise a credentials failure as an unreachable Oblio", async () => {
    const failing: Tokens = { get: async () => fail(authError("Invalid client")), force: async () => "x" };
    withFetch(async () => envelope([]));
    expect(await errorOf(() => api(failing).listCompanies())).toMatchObject({ kind: "auth" });
  });
});
