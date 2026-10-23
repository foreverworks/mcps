import { type HttpRequest, issuesText } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import type { Listed, Page, PortalPort } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import { calculationNoteWire, documentWire, invoicesAnswerWire, portalPageWire, requestRowWire, requestSummaryWire, springPageWire } from "../domain/schema.js";

/**
 * The portal's endpoints, the only module that names them. All reads, all
 * under `/api/v1/portal-core/interf`, which is what the portal's own screens
 * call:
 *
 * - "Cererile mele": GET requests/v2, paged by pageNumber/maxResult, sorted by
 *   creationDate, windowed by fromCreationDate/toCreationDate (instants).
 * - a filing: GET requests/{id}/summary; its file: GET
 *   opis-documents/complete/{id}?page&size.
 * - "Notele mele de calcul": GET calculation-notes/request-details/filter,
 *   same paging, windowed by fromDate/tillDate.
 * - "Facturile mele": GET invoices, same paging and window, the page wrapped
 *   in `invoices`.
 */
export const makePortalApi = (http: HttpRequest, portal: string): PortalPort => {
  const base = `${portal}/api/v1/portal-core/interf`;

  const parsed = <S extends z.ZodType>(schema: S, answer: unknown, what: string): z.infer<S> => {
    const result = schema.safeParse(answer);
    return result.success ? result.data : fail({ kind: "drift", message: `${what}: ${issuesText(result.error)}` });
  };

  const paging = (page: Page) => ({ pageNumber: page.page, maxResult: page.size, sortField: "creationDate", sortDir: "DESC" });

  const spring = <T>(p: { readonly content: readonly T[]; readonly totalElements?: number | null | undefined; readonly last?: boolean | null | undefined }): Listed<T> => ({
    items: p.content,
    total: p.totalElements ?? undefined,
    last: p.last ?? undefined,
  });

  type Metadata = { readonly total?: number | null | undefined; readonly pages?: number | null | undefined; readonly page?: number | null | undefined };
  const portalPage = <T>(p: { readonly data: readonly T[]; readonly metadata?: Metadata | null | undefined }): Listed<T> => {
    const m = p.metadata;
    const last = m?.pages === undefined || m.pages === null || m.page === undefined || m.page === null ? undefined : m.page >= m.pages - 1;
    return { items: p.data, total: m?.total ?? undefined, last };
  };

  return {
    listRequests: async (window, page) =>
      spring(parsed(springPageWire(requestRowWire), await http(`${base}/requests/v2`, { query: { ...paging(page), fromCreationDate: window.from, toCreationDate: window.to } }), "requests/v2")),
    requestSummary: async (id) => parsed(requestSummaryWire, await http(`${base}/requests/${encodeURIComponent(id)}/summary`), "request summary"),
    requestDocuments: async (id, page) =>
      portalPage(parsed(portalPageWire(documentWire), await http(`${base}/opis-documents/complete/${encodeURIComponent(id)}`, { query: { page: page.page, size: page.size } }), "request documents")),
    listCalculationNotes: async (window, page) =>
      portalPage(parsed(portalPageWire(calculationNoteWire), await http(`${base}/calculation-notes/request-details/filter`, { query: { ...paging(page), fromDate: window.from, tillDate: window.to } }), "calculation notes")),
    listInvoices: async (window, page) =>
      portalPage(parsed(invoicesAnswerWire, await http(`${base}/invoices`, { query: { ...paging(page), fromDate: window.from, tillDate: window.to } }), "invoices").invoices),
  };
};
