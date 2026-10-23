/**
 * reverse_invoice against a FAKE OblioPort, and its request on the wire against
 * a stubbed fetch. Invented invoices only: a storno is a real fiscal document,
 * and no test reaches Oblio.
 */
import { describe, expect, it, vi } from "vitest";

import { listSeries } from "../src/app/usecases/nomenclature.js";
import { planReversal, reverseInvoice } from "../src/app/usecases/reverse.js";
import { apiError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import type { ListedInvoice } from "../src/domain/models.js";
import type { ReversalRequest } from "../src/domain/reversal.js";
import { summarizeReversal } from "../src/domain/summary.js";
import { makeOblioHttp } from "../src/infra/http.js";
import { makeOblioApi } from "../src/infra/oblioApi.js";
import { CIF, envelope, errorOf, fakeDeps, oblioStub, withFetch } from "./helpers.js";

const ref = { seriesName: "FCT", number: "0042" };

const invoice = (over: Partial<ListedInvoice> = {}): ListedInvoice => ({
  id: "500100",
  seriesName: "FCT",
  number: "0042",
  issueDate: "2026-09-30",
  currency: "RON",
  total: "1210.0000",
  cancelled: false,
  client: { name: "Client SRL", cif: "RO87654329" },
  ...over,
});

const request = (over: Partial<ReversalRequest> = {}): ReversalRequest => ({ ref, removePayments: false, ...over });

/** A port holding one invoice; the storno is FCT 0043, read back at `stornoTotal`. */
const holding = (held: ListedInvoice | undefined, stornoTotal = "-1210.00") => {
  const issue = vi.fn(async () => ({ seriesName: "FCT", number: "0043", link: "https://oblio.test/pdf/0043" }));
  const read = vi.fn(async (q: { readonly ref: { readonly seriesName: string; readonly number: string } }) => ({ ...q.ref, total: stornoTotal }));
  const find = vi.fn(async () => held);
  return { deps: fakeDeps({ oblio: oblioStub({ findInvoice: find, issueReversal: issue, getInvoice: read }) }), issue, read, find };
};

describe("the plan and the line a person confirms", () => {
  it("names the invoice, its own buyer, the storno's exact total in its currency, and the series", async () => {
    const { deps } = holding(invoice({ currency: "EUR" }));
    const plan = await planReversal(deps, request());
    expect(plan).toMatchObject({ ref, client: "Client SRL", currency: "EUR", total: "1210.00", reversalTotal: "-1210.00", seriesName: "FCT", companyCif: CIF });
    expect(summarizeReversal(plan)).toBe("Issue a reversing invoice for FCT 0042, Client SRL, total -1210.00 EUR, in series FCT");
  });

  it("says what happens to the payments recorded on it, and which series the storno goes into", async () => {
    const paid = invoice({ collects: [{ type: "Ordin de plata", number: "OP 7001", value: "1210.00", issueDate: "2026-10-02" }] });
    const { deps } = holding(paid);
    expect(summarizeReversal(await planReversal(deps, request()))).toContain(", keeping the payment recorded on it");
    expect(summarizeReversal(await planReversal(deps, request({ removePayments: true, seriesName: "STO" })))).toMatch(
      /in series STO, removing the payment recorded on it$/,
    );
  });

  it("derives one key per reversal of an invoice, whatever the day, and keeps a caller's own", async () => {
    const { deps } = holding(invoice());
    const key = (await planReversal(deps, request())).idempotencyKey;
    expect(key).toMatch(/^mcp-oblio-[0-9a-f]{40}$/);
    const later = holding(invoice()).deps;
    expect((await planReversal({ ...later, now: () => 1_900_000_000_000 }, request())).idempotencyKey).toBe(key);
    expect((await planReversal(deps, request({ removePayments: true }))).idempotencyKey).not.toBe(key);
    expect((await planReversal(deps, request({ seriesName: "STO" }))).idempotencyKey).not.toBe(key);
    expect((await planReversal(deps, request({ idempotencyKey: "again-1" }))).idempotencyKey).toBe("again-1");
  });
});

describe("what is refused, with nothing issued", () => {
  const refused = async (held: ListedInvoice | undefined, r: ReversalRequest = request()) => {
    const { deps, issue } = holding(held);
    const error = await errorOf(() => reverseInvoice(deps, r));
    expect(issue).not.toHaveBeenCalled();
    return error;
  };

  it("an invoice that is not there, a cancelled one, and one that is itself a reversal", async () => {
    expect(await refused(undefined)).toMatchObject({ kind: "input", message: expect.stringContaining("no issued invoice FCT 0042") });
    expect((await refused(invoice({ cancelled: true })))?.message).toContain("is cancelled");
    expect((await refused(invoice({ total: "-1210.00" })))?.message).toContain("a reversal itself");
  });

  it("an invoice of another total than the caller expects", async () => {
    expect((await refused(invoice(), request({ expectTotal: "121.00" })))?.message).toContain("totals 1210.0000, not the expected 121.00");
    const { deps, issue } = holding(invoice());
    await reverseInvoice(deps, request({ expectTotal: "1210" }));
    expect(issue).toHaveBeenCalledTimes(1);
  });
});

describe("reverseInvoice", () => {
  it("issues the plan's storno, reads it back, and holds its total to the plan's", async () => {
    const { deps, issue, read } = holding(invoice());
    const out = await reverseInvoice(deps, request());
    expect(issue).toHaveBeenCalledWith({ cif: CIF, plan: expect.objectContaining({ ref, seriesName: "FCT", removePayments: false, idempotencyKey: out.idempotencyKey }) });
    expect(read).toHaveBeenCalledWith({ cif: CIF, ref: expect.objectContaining({ seriesName: "FCT", number: "0043" }) });
    expect(out).toMatchObject({
      seriesName: "FCT",
      number: "0043",
      reverses: { seriesName: "FCT", number: "0042", total: "1210.00", client: "Client SRL" },
      computedTotal: { gross: "-1210.00", currency: "RON" },
      oblioTotal: "-1210.00",
      paymentsRemoved: false,
      companyCif: CIF,
    });
  });

  it("fails loudly, naming the storno that WAS issued, when Oblio's total is not the negated one", async () => {
    const { deps } = holding(invoice(), "-1200.00");
    const error = await errorOf(() => reverseInvoice(deps, request()));
    expect(error).toMatchObject({ kind: "api", reason: "total_mismatch" });
    expect(error?.message).toContain("invoice FCT 0043 WAS ISSUED, but Oblio's total -1200.00 is not the expected -1210.00 RON");
  });

  it("runs on the plan it is given, reading the invoice once", async () => {
    const { deps, find, issue } = holding(invoice());
    await reverseInvoice(deps, request(), await planReversal(deps, request()));
    expect(find).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it("names the key when the outcome is unknown, and forgets the cached series either way", async () => {
    let loads = 0;
    const deps = fakeDeps({
      oblio: oblioStub({
        findInvoice: async () => invoice(),
        listSeries: async () => {
          loads += 1;
          return [];
        },
        issueReversal: async () => fail(apiError(0, "docs/invoice: the connection failed", { reason: OUTCOME_UNKNOWN })),
      }),
    });
    await listSeries(deps);
    const error = await errorOf(() => reverseInvoice(deps, request()));
    expect(error).toMatchObject({ reason: OUTCOME_UNKNOWN, message: expect.stringMatching(/idempotency_key "mcp-oblio-[0-9a-f]{40}"/) });
    await listSeries(deps);
    expect(loads).toBe(2);
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
  const plan = { ref, seriesName: "FCT", removePayments: true, idempotencyKey: "k1" };

  it("issues a storno as Oblio's example for a full reversal shows it, with refund always stated", async () => {
    const calls = withFetch(async () => envelope({ seriesName: "FCT", number: "0043", link: "https://oblio.test/pdf/0043" }));
    await expect(api().issueReversal({ cif: CIF, plan })).resolves.toEqual({ seriesName: "FCT", number: "0043", link: "https://oblio.test/pdf/0043" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://oblio.test/api/docs/invoice" });
    expect(calls[0]?.body).toEqual({
      cif: CIF,
      seriesName: "FCT",
      referenceDocument: { type: "Factura", seriesName: "FCT", number: "0042", refund: 1 },
      idempotencyKey: "k1",
    });
  });

  it("does NOT repeat a storno that met a 5xx", async () => {
    let sent = 0;
    withFetch(async () => {
      sent += 1;
      return new Response("<html>busy</html>", { status: 502 });
    });
    expect(await errorOf(() => api().issueReversal({ cif: CIF, plan }))).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(sent).toBe(1);
  });
});
