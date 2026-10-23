/**
 * collect_invoice against a FAKE OblioPort, and its request and answer on the
 * wire against a stubbed fetch. Invented invoices and payments only: recording
 * a payment is real bookkeeping, and no test reaches Oblio.
 */
import { describe, expect, it, vi } from "vitest";

import { collectInvoice, planCollect } from "../src/app/usecases/collect.js";
import type { CollectRequest } from "../src/domain/payment.js";
import type { ListedInvoice } from "../src/domain/models.js";
import { apiError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { summarizeCollect } from "../src/domain/summary.js";
import { makeOblioHttp } from "../src/infra/http.js";
import { makeOblioApi } from "../src/infra/oblioApi.js";
import { CIF, envelope, errorOf, fakeDeps, listedRow, oblioStub, withFetch } from "./helpers.js";

const ref = { seriesName: "FCT", number: "0042" };

const invoice = (over: Partial<ListedInvoice> = {}): ListedInvoice => ({
  id: "500100",
  seriesName: "FCT",
  number: "0042",
  issueDate: "2026-09-30",
  currency: "RON",
  total: "1210.00",
  cancelled: false,
  client: { name: "Client SRL", cif: "RO87654329" },
  ...over,
});

const request = (over: Partial<CollectRequest> = {}): CollectRequest => ({
  ref,
  type: "Ordin de plata",
  amount: "1210.00",
  date: "2026-10-02",
  documentNumber: "OP 7001",
  ...over,
});

const opPayment = { issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: "1210.00" };

/** A port holding one invoice; a collect answers with the payments it now carries. */
const holding = (held: ListedInvoice, collects = [opPayment]) => {
  const collect = vi.fn(async () => ({ documentType: "Factura", ...ref, collects }));
  const find = vi.fn(async () => held);
  return { deps: fakeDeps({ oblio: oblioStub({ findInvoice: find, collectInvoice: collect }) }), collect, find };
};

describe("the plan and the line a person confirms", () => {
  it("names the invoice's own buyer and currency, the amount, how and when it was paid, and what is left", async () => {
    const { deps } = holding(invoice({ currency: "EUR", collects: [{ type: "Card", number: "POS 1", value: "210", issueDate: "2026-10-01" }] }));
    const plan = await planCollect(deps, request({ amount: "500.00" }));
    expect(plan).toMatchObject({
      ref,
      client: "Client SRL",
      companyCif: CIF,
      balance: { total: "1210.00", currency: "EUR", paid: "210.00", outstanding: "1000.00" },
      outstandingAfter: "500.00",
      payment: { type: "Ordin de plata", documentNumber: "OP 7001", value: "500.00", issueDate: "2026-10-02" },
    });
    expect(summarizeCollect(plan)).toBe(
      "Record 500.00 EUR paid on invoice FCT 0042 to Client SRL, Ordin de plata OP 7001, 2026-10-02, leaving 500.00 EUR unpaid",
    );
  });

  it("names a receipt by its series, since Oblio numbers it", async () => {
    const { deps } = holding(invoice());
    const { documentNumber: _none, ...receipt } = request({ type: "Chitanta", receiptSeries: "CH", amount: "10" });
    const plan = await planCollect(deps, receipt);
    expect(plan.payment).toEqual({ type: "Chitanta", seriesName: "CH", value: "10", issueDate: "2026-10-02" });
    expect(summarizeCollect(plan)).toContain("Chitanta in series CH, 2026-10-02, leaving 1200.00 RON unpaid");
  });

  it("derives the key from the invoice and the payment, so the same payment always carries the same one", async () => {
    const { deps } = holding(invoice());
    const key = (await planCollect(deps, request())).idempotencyKey;
    expect(key).toMatch(/^mcp-oblio-[0-9a-f]{40}$/);
    expect((await planCollect(deps, request())).idempotencyKey).toBe(key);
    expect((await planCollect(deps, request({ amount: "1000.00" }))).idempotencyKey).not.toBe(key);
    expect((await planCollect(deps, request({ date: "2026-10-03" }))).idempotencyKey).not.toBe(key);
    expect((await planCollect(deps, request({ idempotencyKey: "mine-1" }))).idempotencyKey).toBe("mine-1");
  });
});

describe("what is refused, with nothing sent", () => {
  const refused = async (held: ListedInvoice | undefined, r: CollectRequest) => {
    const collect = vi.fn(oblioStub().collectInvoice);
    const deps = fakeDeps({ oblio: oblioStub({ findInvoice: async () => held, collectInvoice: collect }) });
    const error = await errorOf(() => collectInvoice(deps, r));
    expect(collect).not.toHaveBeenCalled();
    return error;
  };

  it("an invoice that is not there", async () => {
    expect(await refused(undefined, request())).toMatchObject({ kind: "input", message: expect.stringContaining("no issued invoice FCT 0042") });
  });

  it("a cancelled invoice, one paid in full, and more than it still owes", async () => {
    expect((await refused(invoice({ cancelled: true }), request()))?.message).toContain("is cancelled");
    const paid = invoice({ collects: [{ ...opPayment, number: "OP 6000", issueDate: "2026-10-01" }] });
    expect((await refused(paid, request()))?.message).toContain("paid in full (1210.00 of 1210.00 RON)");
    expect((await refused(invoice(), request({ amount: "1210.01" })))?.message).toContain("more than the 1210.00 RON");
  });

  it("a payment without its reference, a receipt without its series, a zero or over-precise amount", async () => {
    const { documentNumber: _none, ...noRef } = request();
    expect((await refused(invoice(), noRef))?.message).toContain("needs document_number");
    expect((await refused(invoice(), request({ type: "Chitanta" })))?.message).toContain("needs receipt_series");
    expect((await refused(invoice(), request({ amount: "0" })))?.message).toContain("above zero");
    expect((await refused(invoice(), request({ amount: "10.005" })))?.message).toContain("more than 2 decimals");
  });
});

describe("collectInvoice", () => {
  it("sends the plan's payment with its key, and says what was recorded and what is left", async () => {
    const { deps, collect } = holding(invoice());
    const out = await collectInvoice(deps, request());
    expect(collect).toHaveBeenCalledWith({
      cif: CIF,
      ref,
      payment: { type: "Ordin de plata", documentNumber: "OP 7001", value: "1210.00", issueDate: "2026-10-02" },
      idempotencyKey: out.idempotencyKey,
    });
    expect(out).toMatchObject({ sent: true, recorded: opPayment, balance: { outstanding: "1210.00", outstandingAfter: "0.00" }, companyCif: CIF });
  });

  it("records nothing when the same payment is already on the invoice, which is what makes a retry safe", async () => {
    const { deps, collect } = holding(invoice({ collects: [{ ...opPayment, value: "1210" }] }));
    const plan = await planCollect(deps, request());
    expect(summarizeCollect(plan)).toBe(
      "Record nothing: 1210.00 RON paid on invoice FCT 0042 to Client SRL, Ordin de plata OP 7001, 2026-10-02 is already recorded",
    );
    expect(await collectInvoice(deps, request(), plan)).toMatchObject({ sent: false, alreadyRecorded: { number: "OP 7001" } });
    expect(collect).not.toHaveBeenCalled();
  });

  it("records a deliberately identical second payment when the caller gives a key of their own", async () => {
    const { deps, collect } = holding(invoice({ total: "2420.00", collects: [opPayment] }));
    await collectInvoice(deps, request({ idempotencyKey: "second-instalment" }));
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("runs on the plan it is given, without reading the invoice again", async () => {
    const { deps, find, collect } = holding(invoice());
    const plan = await planCollect(deps, request());
    await collectInvoice(deps, request(), plan);
    expect(find).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("names the key when the outcome is unknown", async () => {
    const lost = oblioStub({
      findInvoice: async () => invoice(),
      collectInvoice: async () => fail(apiError(0, "docs/invoice/collect: the connection failed", { reason: OUTCOME_UNKNOWN })),
    });
    const error = await errorOf(() => collectInvoice(fakeDeps({ oblio: lost }), request()));
    expect(error).toMatchObject({ reason: OUTCOME_UNKNOWN, message: expect.stringMatching(/idempotency_key "mcp-oblio-[0-9a-f]{40}"/) });
  });

  it("says so when Oblio's answer does not list the payment, and fails loudly when it names another invoice", async () => {
    const { deps } = holding(invoice(), []);
    expect(await collectInvoice(deps, request())).toMatchObject({ sent: true, recordCheck: expect.stringContaining("does not list") });
    const other = fakeDeps({
      oblio: oblioStub({ findInvoice: async () => invoice(), collectInvoice: async () => ({ seriesName: "FCT", number: "0041" }) }),
    });
    expect(await errorOf(() => collectInvoice(other, request()))).toMatchObject({ kind: "api", reason: "drift" });
  });
});

describe("on the wire", () => {
  const instant = () => {
    const state = { t: 0 };
    return { now: () => state.t, sleep: async (ms: number) => void (state.t += ms) };
  };
  const api = () =>
    makeOblioApi(
      makeOblioHttp({ get: async () => "tok", force: async () => "tok" }, { clock: instant(), sleep: async () => undefined }),
      async () => "https://oblio.test/api",
    );
  const payment = { type: "Ordin de plata", documentNumber: "OP 7001", value: "1210.00", issueDate: "2026-10-02" } as const;

  it("records a payment with PUT and a JSON body, as Oblio's SDK does, and reads the payments back as text", async () => {
    const calls = withFetch(async () =>
      envelope({ documentType: "Factura", seriesName: "FCT", number: "0042", collects: [{ issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: 1210 }] }),
    );
    const view = await api().collectInvoice({ cif: CIF, ref, payment, idempotencyKey: "k1" });
    expect(calls[0]).toMatchObject({ method: "PUT", url: "https://oblio.test/api/docs/invoice/collect" });
    expect(calls[0]?.body).toEqual({ cif: CIF, seriesName: "FCT", number: "0042", collect: payment, idempotencyKey: "k1" });
    expect(view.collects).toEqual([{ issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: "1210" }]);
  });

  it("does NOT repeat a payment that met a 5xx, because a repeat would be a second payment", async () => {
    let sent = 0;
    withFetch(async () => {
      sent += 1;
      return new Response("<html>busy</html>", { status: 503 });
    });
    expect(await errorOf(() => api().collectInvoice({ cif: CIF, ref, payment, idempotencyKey: "k1" }))).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(sent).toBe(1);
  });

  it("fails loudly, as drift, on a listed payment without its value, so the guard against paying twice never compares blind", async () => {
    withFetch(async () => envelope([listedRow({ number: "0042", collects: [{ issueDate: "2026-10-02", type: "Card", number: "POS 1" }] })]));
    expect(await errorOf(() => api().findInvoice({ cif: CIF, ref }))).toMatchObject({ kind: "api", reason: "drift" });
  });

  it("finds one invoice through the list, the only read that carries its buyer and currency", async () => {
    const calls = withFetch(async () => envelope([listedRow({ number: "42" }), listedRow({ id: "500101", number: "0420" })]));
    const found = await api().findInvoice({ cif: CIF, ref });
    const params = new URL(calls[0]?.url ?? "").searchParams;
    expect([params.get("seriesName"), params.get("number"), params.get("canceled"), params.get("withCollects")]).toEqual(["FCT", "0042", "-1", "1"]);
    expect(found).toMatchObject({ id: "500100", number: "42", client: { name: "Client SRL" }, currency: "RON" });
  });
});
