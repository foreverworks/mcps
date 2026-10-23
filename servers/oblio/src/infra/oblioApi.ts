import type { Query } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import type { OblioPort, RefQuery } from "../app/ports.js";
import type { OblioHttp } from "./http.js";
import { sameDocument } from "../domain/document.js";
import {
  collectInvoiceIn,
  documentIn,
  findInvoiceQuery,
  fromProformaIn,
  invoiceIn,
  invoiceListQuery,
  refIn,
  reversalIn,
} from "./oblioApi/bodies.js";
import {
  toClient,
  toCompany,
  toDocumentView,
  toIssued,
  toListedInvoice,
  toProduct,
  toSeries,
  toVatRate,
} from "./oblioApi/normalize.js";
import { parseData, WIRE } from "./oblioApi/wire.js";

/**
 * The only module that knows Oblio's endpoints and parameter names.
 *
 * Methods and encodings are the PHP SDK's (OblioSoftware/OblioApi @ 027a5cc):
 * reads are GET with a query; issuing is POST, cancel and restore are PUT, and
 * delete is DELETE, each with a JSON body. Every answer is parsed against the
 * documented shape (oblioApi/wire.ts) before it becomes a model
 * (oblioApi/normalize.ts); a 2xx that is not JSON at all is drift too
 * (infra/http.ts), or, for an issue or a delete, an outcome nobody knows.
 *
 * Which requests may be sent twice: reads, cancel and restore land the same
 * however often they arrive. An issue may not (a second invoice, a second
 * number), nor a payment (a second payment). Nor may a delete: if the first
 * one landed, the repeat answers "not found", and a success would be reported
 * as a failure.
 */
export const makeOblioApi = (http: OblioHttp, apiBase: () => Promise<string>): OblioPort => {
  const url = async (endpoint: string): Promise<string> => `${await apiBase()}/${endpoint}`;

  const read = async <T>(endpoint: string, query: Query, schema: z.ZodType<T>): Promise<T> =>
    parseData(schema, await http.request<unknown>(await url(endpoint), { query }), endpoint);

  const issue = async (endpoint: string, body: object) =>
    toIssued(
      parseData(WIRE.issued, await http.issue<unknown>(await url(endpoint), { method: "POST", json: body }), endpoint),
    );

  const change = async (endpoint: string, { cif, ref }: RefQuery) =>
    toDocumentView(
      parseData(
        WIRE.document,
        await http.request<unknown>(await url(endpoint), { method: "PUT", json: refIn(cif, ref) }),
        endpoint,
      ),
    );

  return {
    listCompanies: async () => (await read("nomenclature/companies", {}, WIRE.companies)).map(toCompany),

    listClients: async ({ cif, name, clientCif, offset }) =>
      (await read("nomenclature/clients", { cif, offset, name, clientCif }, WIRE.clients)).map(toClient),

    listProducts: async ({ cif, name, code, offset }) =>
      (await read("nomenclature/products", { cif, offset, name, code }, WIRE.products)).map(toProduct),

    listSeries: async ({ cif }) => (await read("nomenclature/series", { cif }, WIRE.series)).map(toSeries),

    listVatRates: async ({ cif }) => (await read("nomenclature/vat_rates", { cif }, WIRE.vatRates)).map(toVatRate),

    getInvoice: async ({ cif, ref }) => toDocumentView(await read("docs/invoice", refIn(cif, ref), WIRE.document)),

    getProforma: async ({ cif, ref }) => toDocumentView(await read("docs/proforma", refIn(cif, ref), WIRE.document)),

    listInvoices: async ({ cif, ...q }) =>
      (await read("docs/invoice/list", invoiceListQuery(cif, q), WIRE.invoiceList)).map(toListedInvoice),

    // The list, not the document view: only the list carries the buyer and the currency.
    findInvoice: async ({ cif, ref }) =>
      (await read("docs/invoice/list", findInvoiceQuery(cif, ref), WIRE.invoiceList))
        .map(toListedInvoice)
        .find((row) => sameDocument(ref, row)),

    // A PUT, but not one to send twice: a repeat records a second payment. Paced
    // as issuing, since a payment by receipt makes a document (the Chitanta).
    collectInvoice: async ({ cif, ref, payment, idempotencyKey }) => {
      const endpoint = "docs/invoice/collect";
      const body = await http.issue<unknown>(await url(endpoint), {
        method: "PUT",
        json: collectInvoiceIn(cif, ref, payment, idempotencyKey),
        idempotent: false,
      });
      return toDocumentView(parseData(WIRE.document, body, endpoint));
    },

    issueInvoice: ({ cif, draft }) => issue("docs/invoice", invoiceIn(cif, draft)),

    issueProforma: ({ cif, draft }) => issue("docs/proforma", documentIn(cif, draft)),

    issueInvoiceFromProforma: ({ cif, draft }) => issue("docs/invoice", fromProformaIn(cif, draft)),

    issueReversal: ({ cif, plan }) => issue("docs/invoice", reversalIn(cif, plan)),

    cancelInvoice: (q) => change("docs/invoice/cancel", q),

    restoreInvoice: (q) => change("docs/invoice/restore", q),

    deleteInvoice: async ({ cif, ref }) => {
      const endpoint = "docs/invoice";
      const body = await http.request<unknown>(await url(endpoint), { method: "DELETE", json: refIn(cif, ref), idempotent: false });
      const gone = parseData(WIRE.deleted, body, endpoint);
      return { seriesName: gone.seriesName, number: String(gone.number) };
    },
  };
};
