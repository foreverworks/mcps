import { calculationNoteView, documentView, invoiceView, requestSummaryView, requestView } from "../../domain/views.js";
import { edges, windowOf } from "../../domain/window.js";
import type { Deps, Listed, Page } from "../ports.js";

/**
 * The account's filings and what hangs off them. Every one of these needs the
 * session; a missing or dead one surfaces from the portal port as
 * `needs_login`, with the remedy that names the login tools.
 */

export type ListArgs = { readonly from?: string | undefined; readonly to?: string | undefined; readonly page: number; readonly size: number };

const paged = <T, V>(listed: Listed<T>, view: (item: T) => V, page: Page) => ({
  ok: true as const,
  page: page.page,
  size: page.size,
  ...(listed.total === undefined ? {} : { total: listed.total }),
  ...(listed.last === undefined ? {} : { last: listed.last }),
  count: listed.items.length,
  items: listed.items.map(view),
});

const windowAnd = (deps: Deps, args: ListArgs) => {
  const window = windowOf(args.from, args.to, deps.now() * 1000);
  return { window, span: edges(window), page: { page: args.page, size: args.size } };
};

export const listRequests = async (deps: Deps, args: ListArgs) => {
  const { window, span, page } = windowAnd(deps, args);
  return { window, ...paged(await deps.portal.listRequests(span, page), requestView, page) };
};

/** One filing: its summary (status, the two terms) and the documents in its file. */
export const getRequest = async (deps: Deps, args: { readonly id: string }) => {
  const page = { page: 0, size: 50 };
  const [summary, documents] = await Promise.all([deps.portal.requestSummary(args.id), deps.portal.requestDocuments(args.id, page)]);
  return { ok: true as const, request: requestSummaryView(summary), documents: documents.items.map(documentView) };
};

export const listCalculationNotes = async (deps: Deps, args: ListArgs) => {
  const { window, span, page } = windowAnd(deps, args);
  return { window, ...paged(await deps.portal.listCalculationNotes(span, page), calculationNoteView, page) };
};

export const listInvoices = async (deps: Deps, args: ListArgs) => {
  const { window, span, page } = windowAnd(deps, args);
  return { window, ...paged(await deps.portal.listInvoices(span, page), invoiceView, page) };
};
