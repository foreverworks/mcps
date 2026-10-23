/**
 * list_invoices: the query Oblio is sent, what a listed row becomes, and how a
 * cursor carries a listing from one page to the next. Recorded answers with
 * invented data only; no request leaves the test.
 */
import { describe, expect, it, vi } from "vitest";

import { listInvoices } from "../src/app/usecases/listing.js";
import type { InvoiceFilter } from "../src/domain/invoiceList.js";
import type { ListedInvoice } from "../src/domain/models.js";
import { makeOblioHttp } from "../src/infra/http.js";
import { makeOblioApi } from "../src/infra/oblioApi.js";
import { listArgs, toListInvoicesArgs } from "../src/mcp/listArgs.js";
import { CIF, envelope, errorOf, fakeDeps, listedRow, oblioStub, withFetch } from "./helpers.js";

const instant = () => {
  const state = { t: 0 };
  return { now: () => state.t, sleep: async (ms: number) => void (state.t += ms) };
};

const api = () =>
  makeOblioApi(
    makeOblioHttp({ get: async () => "tok", force: async () => "tok" }, { clock: instant(), sleep: async () => undefined }),
    async () => "https://oblio.test/api",
  );

const newest: InvoiceFilter = { order: "newest" };

const row = (id: number, over: Partial<ListedInvoice> = {}): ListedInvoice => ({
  id: String(id),
  seriesName: "FCT",
  number: String(id).padStart(4, "0"),
  issueDate: "2026-09-30",
  currency: "RON",
  total: "121.00",
  cancelled: false,
  ...over,
});

/** Ids from `top` down, as Oblio answers newest first. */
const desc = (top: number, n: number) => Array.from({ length: n }, (_, i) => row(top - i));

const args = (a: Record<string, unknown>) => toListInvoicesArgs(listArgs.parse(a));

describe("the list query", () => {
  it("asks by Oblio's own parameter names, every flag explicit, drafts out, payments and SPV state in", async () => {
    const calls = withFetch(async () => envelope([]));
    await api().listInvoices({
      cif: CIF,
      filter: {
        issuedAfter: "2026-09-01",
        issuedBefore: "2026-09-30",
        seriesName: "FCT",
        client: { cif: "RO87654329" },
        status: "unpaid",
        order: "newest",
      },
      offset: 0,
      limit: 50,
    });
    const url = new URL(calls[0]?.url ?? "");
    expect(calls[0]?.method).toBe("GET");
    expect(url.pathname).toBe("/api/docs/invoice/list");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cif: CIF,
      seriesName: "FCT",
      "client[cif]": "RO87654329",
      draft: "0",
      canceled: "0",
      collected: "0",
      issuedAfter: "2026-09-01",
      issuedBefore: "2026-09-30",
      withCollects: "1",
      withEinvoiceStatus: "1",
      orderBy: "id",
      orderDir: "DESC",
      limitPerPage: "50",
      offset: "0",
    });
  });

  it("maps each status onto Oblio's two flags, and sends -1 when none is asked for", async () => {
    const calls = withFetch(async () => envelope([]));
    for (const status of [undefined, "paid", "cancelled"] as const)
      await api().listInvoices({ cif: CIF, filter: { order: "oldest", ...(status === undefined ? {} : { status }) }, offset: 100, limit: 100 });
    const flags = calls.map((c) => {
      const p = new URL(c.url).searchParams;
      return [p.get("canceled"), p.get("collected"), p.get("orderDir"), p.get("offset")];
    });
    expect(flags).toEqual([
      ["-1", "-1", "ASC", "100"],
      ["0", "1", "ASC", "100"],
      ["1", "-1", "ASC", "100"],
    ]);
  });
});

describe("a listed invoice", () => {
  it("is read from the documented row: flags as booleans, the total as Oblio wrote it, no zero exchange rate", async () => {
    withFetch(async () =>
      envelope([
        listedRow({
          collects: [{ issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: "1210.00" }],
        }),
        listedRow({ id: 500099, number: "0125", canceled: "1", currency: "EUR", exchangeRate: "4.9750", einvoiceStatus: { text: "Trimisa", sent: true, code: 1 }, collects: [] }),
      ]),
    );
    await expect(api().listInvoices({ cif: CIF, filter: newest, offset: 0, limit: 50 })).resolves.toEqual([
      {
        id: "500100",
        seriesName: "FCT",
        number: "0126",
        issueDate: "2026-09-30",
        dueDate: "2026-10-30",
        currency: "RON",
        total: "1210.0000",
        cancelled: false,
        client: { name: "Client SRL", cif: "RO87654329", email: "billing@example.com" },
        collects: [{ issueDate: "2026-10-02", type: "Ordin de plata", number: "OP 7001", value: "1210.00" }],
        efactura: { state: "not_sent", code: -1, text: "Neconfigurat" },
        link: "https://oblio.test/utils/show_file/?id=500100&preload=1",
      },
      {
        id: "500099",
        seriesName: "FCT",
        number: "0125",
        issueDate: "2026-09-30",
        dueDate: "2026-10-30",
        currency: "EUR",
        exchangeRate: "4.9750",
        total: "1210.0000",
        cancelled: true,
        client: { name: "Client SRL", cif: "RO87654329", email: "billing@example.com" },
        efactura: { state: "sent", code: 1, text: "Trimisa" },
        link: "https://oblio.test/utils/show_file/?id=500100&preload=1",
      },
    ]);
  });

  it("keeps an e-Factura code Oblio does not document, without inventing a state for it", async () => {
    withFetch(async () => envelope([listedRow({ einvoiceStatus: { text: "Altceva", code: "7" } })]));
    const [one] = await api().listInvoices({ cif: CIF, filter: newest, offset: 0, limit: 50 });
    expect(one?.efactura).toEqual({ code: 7, text: "Altceva" });
  });

  it("fails loudly, as drift, when a row has no total", async () => {
    const { total: _gone, ...noTotal } = listedRow();
    withFetch(async () => envelope([noTotal]));
    const error = await errorOf(() => api().listInvoices({ cif: CIF, filter: newest, offset: 0, limit: 50 }));
    expect(error).toMatchObject({ kind: "api", reason: "drift" });
    expect(error?.message).toContain("docs/invoice/list");
  });
});

describe("listInvoices", () => {
  it("offers a cursor only after a full page, and the cursor reads on from where the page ended", async () => {
    const list = vi.fn(async (q: { readonly offset: number }) => (q.offset === 0 ? desc(900, 2) : [row(898)]));
    const deps = fakeDeps({ oblio: oblioStub({ listInvoices: list }) });
    const first = await listInvoices(deps, { filter: newest, limit: 2 });
    expect(first).toMatchObject({ count: 2, companyCif: CIF, nextCursor: expect.any(String) });
    const second = await listInvoices(deps, { filter: newest, limit: 2, cursor: first.nextCursor ?? "" });
    expect(list.mock.calls.map(([q]) => q.offset)).toEqual([0, 2]);
    expect(second).toEqual({ count: 1, invoices: [row(898)], companyCif: CIF });
  });

  it("drops a row the page before already showed, when an invoice issued in between pushed the list down", async () => {
    // Page one read 900 and 899; then 901 was issued, so offset 2 now starts at 899.
    const list = vi.fn(async (q: { readonly offset: number }) => (q.offset === 0 ? desc(900, 2) : desc(899, 2)));
    const deps = fakeDeps({ oblio: oblioStub({ listInvoices: list }) });
    const first = await listInvoices(deps, { filter: newest, limit: 2 });
    const second = await listInvoices(deps, { filter: newest, limit: 2, cursor: first.nextCursor ?? "" });
    expect(second.invoices.map((i) => i.id)).toEqual(["898"]);
    expect(second).toMatchObject({ scanned: 2, nextCursor: expect.any(String) });
  });

  it("refuses a cursor made for other filters, and one it did not make", async () => {
    const deps = fakeDeps({ oblio: oblioStub({ listInvoices: async () => desc(900, 2) }) });
    const { nextCursor } = await listInvoices(deps, { filter: { order: "newest", status: "unpaid" }, limit: 2 });
    const other = await errorOf(() => listInvoices(deps, { filter: { order: "newest", status: "paid" }, limit: 2, cursor: nextCursor ?? "" }));
    expect(other).toMatchObject({ kind: "input", message: expect.stringContaining("other filters") });
    const forged = await errorOf(() => listInvoices(deps, { filter: newest, limit: 2, cursor: "not-a-cursor" }));
    expect(forged).toMatchObject({ kind: "input", message: expect.stringContaining("not one list_invoices returned") });
  });

  it("shows only the e-Factura states asked for, says how many rows it read, and still offers the next page", async () => {
    const rows = [
      row(900, { efactura: { state: "errors", code: 2, text: "Erori" } }),
      row(899, { efactura: { state: "sent", code: 1 } }),
      row(898),
    ];
    const deps = fakeDeps({ oblio: oblioStub({ listInvoices: async () => rows }) });
    const out = await listInvoices(deps, { filter: { order: "newest", efactura: ["errors"] }, limit: 3 });
    expect(out.invoices.map((i) => i.id)).toEqual(["900"]);
    expect(out).toMatchObject({ count: 1, scanned: 3, nextCursor: expect.any(String) });
  });
});

describe("the list arguments", () => {
  it("become a filter with only what was given, newest first by default", () => {
    expect(args({ client_cif: "RO87654329", efactura: ["sent", "errors", "sent"] })).toEqual({
      filter: { client: { cif: "RO87654329" }, efactura: ["errors", "sent"], order: "newest" },
      limit: 50,
    });
  });

  it("refuse a period that ends before it starts", async () => {
    const error = await errorOf(() => args({ issued_after: "2026-10-01", issued_before: "2026-09-01" }));
    expect(error).toMatchObject({ kind: "input", message: expect.stringContaining("is after issued_before") });
  });
});
