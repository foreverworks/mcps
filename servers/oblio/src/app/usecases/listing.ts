import { decodeCursor, encodeCursor, inEfacturaStates, type InvoiceFilter, unseen } from "../../domain/invoiceList.js";
import type { Deps } from "../ports.js";
import { scope } from "./nomenclature.js";

/** Oblio's largest page on the document list: "Rezultate pe pagina. Maxim 100". */
export const LIST_PAGE_MAX = 100;

export type ListInvoicesArgs = { readonly filter: InvoiceFilter; readonly limit: number; readonly cursor?: string };

/**
 * One page of the company's issued invoices.
 *
 * `nextCursor` is present only when Oblio returned a full page, the only sign
 * it has more. With an e-Factura filter, which Oblio's list does not have, a
 * page is read whole and only its matching rows are shown: `scanned` then
 * says how many were read, and a page can show none and still offer a
 * cursor.
 */
export const listInvoices = async (deps: Deps, args: ListInvoicesArgs) => {
  const q = await scope(deps);
  const from = args.cursor === undefined ? undefined : decodeCursor(args.cursor, args.filter);
  const offset = from?.offset ?? 0;
  const read = await deps.oblio.listInvoices({ ...q, filter: args.filter, offset, limit: args.limit });
  const fresh = from === undefined ? read : unseen(read, args.filter.order, from.lastId);
  const invoices = args.filter.efactura === undefined ? fresh : inEfacturaStates(fresh, args.filter.efactura);
  const last = read.at(-1);
  return {
    count: invoices.length,
    ...(invoices.length < read.length ? { scanned: read.length } : {}),
    invoices,
    ...(read.length >= args.limit && last !== undefined
      ? { nextCursor: encodeCursor(args.filter, offset + read.length, last.id) }
      : {}),
    companyCif: q.cif,
  };
};
