/**
 * Use cases against a FAKE OblioPort. No network, no account, no invoice
 * issued against anybody's real company.
 */
import { describe, expect, it, vi } from "vitest";

import {
  cancelInvoice,
  createInvoice,
  createProforma,
  deleteInvoice,
  getInvoice,
  invoiceFromProforma,
} from "../src/app/usecases/documents.js";
import { checkHealth, listClients, listCompanies, listSeries } from "../src/app/usecases/nomenclature.js";
import { apiError, fail, OUTCOME_UNKNOWN } from "../src/domain/errors.js";
import { CIF, errorOf, fakeDeps, invoice, oblioStub } from "./helpers.js";

describe("the company scope", () => {
  it("comes from app.json on every call", async () => {
    const get = vi.fn(oblioStub().getInvoice);
    await getInvoice(fakeDeps({ oblio: oblioStub({ getInvoice: get }) }), { seriesName: "FCT", number: "0042" });
    expect(get).toHaveBeenCalledWith({ cif: CIF, ref: { seriesName: "FCT", number: "0042" } });
  });
});

describe("createInvoice", () => {
  it("returns what was issued, the exact total, the total read back, and the key it was sent with", async () => {
    const issue = vi.fn(oblioStub().issueInvoice);
    const read = vi.fn(oblioStub().getInvoice);
    const out = await createInvoice(fakeDeps({ oblio: oblioStub({ issueInvoice: issue, getInvoice: read }) }), invoice());
    expect(out).toMatchObject({
      seriesName: "FCT",
      number: "0043",
      computedTotal: { net: "1000.00", vat: "210.00", gross: "1210.00", currency: "RON" },
      oblioTotal: "1210.00",
      idempotencyKey: expect.stringMatching(/^mcp-oblio-[0-9a-f]{40}$/),
      companyCif: CIF,
    });
    expect(issue.mock.calls[0]?.[0]).toMatchObject({ cif: CIF, draft: { idempotencyKey: out.idempotencyKey } });
    expect(read).toHaveBeenCalledWith({ cif: CIF, ref: { seriesName: "FCT", number: "0043" } });
  });

  it("derives the key from the document and its day, so an identical retry carries the same one", async () => {
    const deps = fakeDeps();
    const first = await createInvoice(deps, invoice());
    expect((await createInvoice(deps, invoice())).idempotencyKey).toBe(first.idempotencyKey);
    expect((await createInvoice(deps, invoice({ issueDate: "2026-10-01" }))).idempotencyKey).not.toBe(first.idempotencyKey);
    expect((await createInvoice(fakeDeps({}, () => 1_800_000_000_000 + 86_400_000), invoice())).idempotencyKey).not.toBe(first.idempotencyKey);
    expect((await createProforma(deps, invoice())).idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("fails loudly, naming the document that WAS issued, when Oblio's total is not the computed one", async () => {
    const deps = fakeDeps({ oblio: oblioStub({ getInvoice: async (q) => ({ ...q.ref, total: "1210.01" }) }) });
    const error = await errorOf(() => createInvoice(deps, invoice()));
    expect(error).toMatchObject({ kind: "api", reason: "total_mismatch" });
    expect(error?.message).toContain("invoice FCT 0043 WAS ISSUED, but Oblio's total 1210.01 is not the expected 1210.00 RON");
  });

  it("does not fail an issued invoice because the read-back failed, and says the total was not checked", async () => {
    const deps = fakeDeps({ oblio: oblioStub({ getInvoice: async () => fail(apiError(503, "busy")) }) });
    const out = await createInvoice(deps, invoice());
    expect(out).toMatchObject({ number: "0043", totalCheck: expect.stringContaining("not read back") });
    expect(out).not.toHaveProperty("oblioTotal");
  });

  it("says where Oblio emails it", async () => {
    const out = await createInvoice(fakeDeps(), invoice({ sendEmail: true, client: { name: "Client SRL", email: "billing@example.com" } }));
    expect(out).toMatchObject({ emailedTo: "billing@example.com" });
  });

  it("keeps a key the caller gave", async () => {
    const out = await createInvoice(fakeDeps(), invoice({ idempotencyKey: "retry-me" }));
    expect(out.idempotencyKey).toBe("retry-me");
  });

  it("refuses a document that breaks a rule before anything is sent", async () => {
    const issue = vi.fn(oblioStub().issueInvoice);
    const error = await errorOf(() =>
      createInvoice(
        fakeDeps({ oblio: oblioStub({ issueInvoice: issue }) }),
        invoice({ products: [{ name: "x", price: "1.005", quantity: "1", vatPercentage: "21", vatIncluded: false }] }),
      ),
    );
    expect(error?.kind).toBe("input");
    expect(issue).not.toHaveBeenCalled();
  });

  it("names the idempotency key when the outcome is unknown, so the retry cannot issue twice", async () => {
    const lost = oblioStub({
      issueInvoice: async () => fail(apiError(0, "docs/invoice: the connection failed", { reason: OUTCOME_UNKNOWN })),
    });
    const error = await errorOf(() => createInvoice(fakeDeps({ oblio: lost }), invoice()));
    expect(error).toMatchObject({ reason: OUTCOME_UNKNOWN });
    expect(error?.message).toMatch(/idempotency_key "mcp-oblio-[0-9a-f]{40}"/);
  });

  it("forgets the cached series, whose next number has moved, even when the issue failed", async () => {
    let loads = 0;
    const deps = fakeDeps({
      oblio: oblioStub({
        listSeries: async () => {
          loads += 1;
          return [];
        },
        issueInvoice: async () => fail(apiError(400, "Seria FCT nu exista")),
      }),
    });
    await listSeries(deps);
    await errorOf(() => createInvoice(deps, invoice()));
    await listSeries(deps);
    expect(loads).toBe(2);
  });
});

describe("invoiceFromProforma", () => {
  it("reads the proforma first, links the two documents, and holds the invoice's total to the proforma's", async () => {
    const issue = vi.fn(oblioStub().issueInvoiceFromProforma);
    const out = await invoiceFromProforma(fakeDeps({ oblio: oblioStub({ issueInvoiceFromProforma: issue }) }), {
      invoiceSeries: "FCT",
      proforma: { seriesName: "PR", number: "0007" },
    });
    expect(issue).toHaveBeenCalledWith({
      cif: CIF,
      draft: { invoiceSeries: "FCT", proforma: { seriesName: "PR", number: "0007" }, idempotencyKey: expect.stringMatching(/^mcp-oblio-/) },
    });
    expect(out).toMatchObject({ number: "0044", fromProforma: { seriesName: "PR", number: "0007", total: "1210.00" }, oblioTotal: "1210.00" });
  });
});

describe("deleteInvoice", () => {
  const ref = { seriesName: "FCT", number: "0042" };

  it("says which document went, and what it totalled", async () => {
    await expect(deleteInvoice(fakeDeps(), { ref })).resolves.toEqual({
      deleted: { seriesName: "FCT", number: "0042", total: "1210.00" },
      companyCif: CIF,
    });
  });

  it("changes nothing when the invoice does not total what the caller expects", async () => {
    const remove = vi.fn(oblioStub().deleteInvoice);
    const deps = fakeDeps({ oblio: oblioStub({ deleteInvoice: remove }) });
    const error = await errorOf(() => deleteInvoice(deps, { ref, expectTotal: "121.00" }));
    expect(error).toMatchObject({ kind: "input", message: expect.stringContaining("totals 1210.00, not the expected 121.00") });
    expect(remove).not.toHaveBeenCalled();
    await expect(deleteInvoice(deps, { ref, expectTotal: "1210.0" })).resolves.toMatchObject({ companyCif: CIF });
  });

  it("fails loudly when Oblio answers for another document than the one asked for", async () => {
    const deps = fakeDeps({ oblio: oblioStub({ deleteInvoice: async () => ({ seriesName: "FCT", number: "0041" }) }) });
    const error = await errorOf(() => deleteInvoice(deps, { ref }));
    expect(error).toMatchObject({ kind: "api", reason: "drift" });
    expect(error?.message).toContain("FCT 0041, not FCT 0042");
  });
});

describe("cancelInvoice", () => {
  it("echoes the document and the company it acted on, matching a zero-padded number by value", async () => {
    const deps = fakeDeps({ oblio: oblioStub({ cancelInvoice: async () => ({ seriesName: "FCT", number: "42", total: "121.00" }) }) });
    await expect(cancelInvoice(deps, { ref: { seriesName: "fct", number: "0042" } })).resolves.toEqual({
      seriesName: "FCT",
      number: "42",
      total: "121.00",
      before: { total: "1210.00" },
      companyCif: CIF,
    });
  });
});

describe("the nomenclature", () => {
  it("is cached, and says since when", async () => {
    let loads = 0;
    const deps = fakeDeps({
      oblio: oblioStub({
        listCompanies: async () => {
          loads += 1;
          return [{ cif: CIF, name: "Example SRL" }];
        },
      }),
    });
    const first = await listCompanies(deps);
    await listCompanies(deps);
    expect(loads).toBe(1);
    expect(first).toMatchObject({ count: 1, asOf: "2027-01-15T08:00:00.000Z" });
  });

  it("is never cached for the health check, which is about the credentials now", async () => {
    let loads = 0;
    const deps = fakeDeps({
      oblio: oblioStub({
        listCompanies: async () => {
          loads += 1;
          return [{ cif: CIF, name: "Example SRL" }];
        },
      }),
    });
    await checkHealth(deps);
    await checkHealth(deps);
    expect(loads).toBe(2);
  });

  it("health says whether the configured CIF is one the account reaches", async () => {
    expect(await checkHealth(fakeDeps())).toMatchObject({ companyCif: CIF, companyReachable: true });
    const other = oblioStub({ listCompanies: async () => [{ cif: "RO99999999", name: "Other" }] });
    expect(await checkHealth(fakeDeps({ oblio: other }))).toMatchObject({ companyReachable: false });
  });
});

describe("listClients", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `C${i}` }));

  it("passes only the filters that were given", async () => {
    const list = vi.fn(oblioStub().listClients);
    await listClients(fakeDeps({ oblio: oblioStub({ listClients: list }) }), { offset: 0, limit: 250, name: "Ex" });
    expect(list).toHaveBeenCalledWith({ cif: CIF, offset: 0, name: "Ex" });
  });

  it("cuts to the limit, counts what it held back, and offers the next page only after a full one", async () => {
    const full = await listClients(fakeDeps({ oblio: oblioStub({ listClients: async () => rows(250) }) }), { offset: 0, limit: 5 });
    expect(full).toMatchObject({ count: 5, omitted: 245, nextOffset: 250 });
    const last = await listClients(fakeDeps({ oblio: oblioStub({ listClients: async () => rows(3) }) }), { offset: 250, limit: 250 });
    expect(last).toEqual({ count: 3, clients: rows(3) });
  });
});
