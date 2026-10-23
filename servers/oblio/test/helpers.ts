/**
 * Shared test plumbing. Every state dir is a fresh temp dir and every request
 * is answered by a stubbed fetch: the isolation setup (packages/mcp-kit
 * testing/isolate.ts) refuses anything else, and no default path exists that
 * could lead to a real app.json on the machine running the tests.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { makeNomenclatureCache } from "../src/app/nomenclatureCache.js";
import type { Deps, OblioPort } from "../src/app/ports.js";
import { asAppError } from "../src/domain/errors.js";
import type { InvoiceDraft } from "../src/domain/document.js";

export const CIF = "RO92345672";

export const tempDir = (prefix = "oblio-test-"): string => mkdtempSync(join(tmpdir(), prefix));

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const envelope = (data: unknown): Response => json({ status: 200, statusMessage: "Success", data });

const jsonOrText = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

export type FetchCall = { readonly url: string; readonly method: string; readonly body: unknown };

/** Stub fetch for one test; `calls` records what was asked, parsed. */
export const withFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body;
    const body = typeof raw === "string" ? jsonOrText(raw) : raw instanceof URLSearchParams ? raw.toString() : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    return impl(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return calls;
};

export const errorOf = async (run: () => unknown) => {
  try {
    await run();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

export const oblioStub = (over: Partial<OblioPort> = {}): OblioPort => ({
  listCompanies: async () => [{ cif: CIF, name: "Example SRL" }],
  listClients: async () => [],
  listProducts: async () => [],
  listSeries: async () => [{ type: "Factura", name: "FCT", next: "0043", isDefault: true }],
  listVatRates: async () => [{ name: "Normala", percent: "21", isDefault: true }],
  // What a read gives back: the document asked for, totalling what the default invoice() computes to.
  getInvoice: async (q) => ({ ...q.ref, total: "1210.00" }),
  getProforma: async (q) => ({ ...q.ref, total: "1210.00" }),
  listInvoices: async () => [],
  findInvoice: async (q) => ({
    id: "500100",
    ...q.ref,
    issueDate: "2026-09-30",
    currency: "RON",
    total: "1210.00",
    cancelled: false,
    client: { name: "Client SRL", cif: "RO87654329" },
  }),
  collectInvoice: async (q) => ({ ...q.ref, collects: [{ type: q.payment.type, number: q.payment.documentNumber ?? "CH 0001", value: q.payment.value ?? "0", issueDate: q.payment.issueDate ?? "" }] }),
  issueInvoice: async () => ({ seriesName: "FCT", number: "0043" }),
  issueProforma: async () => ({ seriesName: "PR", number: "0008" }),
  issueInvoiceFromProforma: async () => ({ seriesName: "FCT", number: "0044" }),
  issueReversal: async () => ({ seriesName: "FCT", number: "0045" }),
  cancelInvoice: async () => ({ seriesName: "FCT", number: "0042" }),
  restoreInvoice: async () => ({ seriesName: "FCT", number: "0042" }),
  deleteInvoice: async (q) => q.ref,
  ...over,
});

/** Deps over a fake port; the nomenclature cache is the real one, over that same port. */
export const fakeDeps = (over: Partial<Deps> = {}, now: () => number = () => 1_800_000_000_000): Deps => {
  const oblio = over.oblio ?? oblioStub();
  return {
    oblio,
    paths: { config: "/nonexistent/app.json", stateDir: "/nonexistent/state" },
    identity: async () => ({ accountId: "account@example.test", companyCif: CIF }),
    cache: makeNomenclatureCache(oblio, 600_000, now),
    now,
    ...over,
  };
};

export const invoice = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  client: { name: "Client SRL", cif: "RO87654329", vatPayer: true },
  seriesName: "FCT",
  precision: 2,
  currency: "RON",
  products: [{ name: "Consulting", price: "1000.00", quantity: "1", vatPercentage: "21", vatIncluded: false }],
  ...over,
});

/**
 * One row of GET /api/docs/invoice/list as Oblio's documented example shows it
 * (every value a string, a RON invoice's exchange rate "0.000000"), with
 * invented data in place of the example's.
 */
export const listedRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "500100",
  draft: "0",
  canceled: "0",
  seriesName: "FCT",
  number: "0126",
  issueDate: "2026-09-30",
  dueDate: "2026-10-30",
  precision: "2",
  currency: "RON",
  exchangeRate: "0.000000",
  total: "1210.0000",
  issuerName: "",
  issuerId: "",
  noticeNumber: "",
  deputyName: "",
  deputyIdentityCard: "",
  deputyAuto: "",
  mentions: "",
  useStock: "0",
  indexUpload: null,
  idDownload: null,
  type: "Factura",
  link: "https://oblio.test/utils/show_file/?id=500100&preload=1",
  einvoice: "https://oblio.test/utils/show_file/?id=500100&einvoice=1",
  einvoiceStatus: { text: "Neconfigurat", sent: false, code: -1 },
  client: {
    clientId: "77001",
    cif: "RO87654329",
    name: "Client SRL",
    rc: "J99/123/2020",
    code: "",
    address: "Strada Exemplu 1",
    state: "Bucuresti",
    city: "Bucuresti",
    country: "",
    iban: "",
    bank: "",
    contact: "",
    phone: "",
    email: "billing@example.com",
    vatPayer: "1",
  },
  ...over,
});
