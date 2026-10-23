import { sha256Of } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import { canonical } from "./keys.js";
import type { EfacturaState, ListedInvoice } from "./models.js";

/**
 * Listing issued invoices: the filter a caller narrows by, the cursor that
 * carries a listing from one page to the next, and the two things done to a
 * page after Oblio answers it.
 */

/** "unpaid" and "paid" leave cancelled invoices out; "paid" is Oblio's collected (incasat). */
export const INVOICE_STATUSES = ["unpaid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** By Oblio's id, which is the order documents were created in. */
export const LIST_ORDERS = ["newest", "oldest"] as const;
export type ListOrder = (typeof LIST_ORDERS)[number];

export type ClientFilter = { readonly cif?: string; readonly email?: string; readonly code?: string };

/** Every field narrows the list; with none, every issued invoice is listed. Drafts never are. */
export type InvoiceFilter = {
  readonly issuedAfter?: string;
  readonly issuedBefore?: string;
  readonly seriesName?: string;
  readonly client?: ClientFilter;
  readonly status?: InvoiceStatus;
  /** Oblio's list cannot filter by it, so it is applied to each page here. */
  readonly efactura?: readonly EfacturaState[];
  readonly order: ListOrder;
};

/**
 * Where the next page starts. `offset` is the position in Oblio's list;
 * `lastId` the last invoice already read, which tells a repeated row from a
 * new one (`unseen`); `query` the filter it was made for, so a cursor cannot
 * carry one listing's position into another.
 */
export type Cursor = { readonly offset: number; readonly lastId: string; readonly query: string };

const fingerprint = (filter: InvoiceFilter): string => sha256Of(Buffer.from(canonical(filter), "utf8")).slice(0, 16);

export const encodeCursor = (filter: InvoiceFilter, offset: number, lastId: string): string =>
  Buffer.from(JSON.stringify({ offset, lastId, query: fingerprint(filter) } satisfies Cursor)).toString("base64url");

const isCursor = (value: unknown): value is Cursor => {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c["offset"] === "number" &&
    Number.isSafeInteger(c["offset"]) &&
    c["offset"] >= 0 &&
    typeof c["lastId"] === "string" &&
    /^[0-9]{1,20}$/.test(c["lastId"]) &&
    typeof c["query"] === "string"
  );
};

/** The cursor a previous page handed back, held to the filter it is used with. */
export const decodeCursor = (text: string, filter: InvoiceFilter): Cursor => {
  const parsed = ((): unknown => {
    try {
      return JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    } catch {
      return undefined;
    }
  })();
  if (!isCursor(parsed)) return fail(inputError("cursor is not one list_invoices returned; pass nextCursor exactly as it came back"));
  if (parsed.query !== fingerprint(filter))
    return fail(
      inputError("cursor belongs to a listing with other filters; repeat the filters it came with, or leave cursor out to start again"),
    );
  return parsed;
};

/** Ids are digit strings of any length; compared as integers. */
const compareIds = (a: string, b: string): number => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * The rows of a page not already shown. Newest first, an invoice issued
 * between two pages pushes the list down by one, so the next page would begin
 * with the last row of the page before; anything at or beyond the last id
 * read is such a repeat. Oldest first, new invoices join at the end, and the
 * check costs nothing.
 */
export const unseen = (rows: readonly ListedInvoice[], order: ListOrder, lastId: string): readonly ListedInvoice[] =>
  rows.filter((row) => (order === "newest" ? compareIds(row.id, lastId) < 0 : compareIds(row.id, lastId) > 0));

/** The rows whose e-Factura state is one of those asked for; a row Oblio gave no state for matches none. */
export const inEfacturaStates = (rows: readonly ListedInvoice[], states: readonly EfacturaState[]): readonly ListedInvoice[] =>
  rows.filter((row) => row.efactura?.state !== undefined && states.includes(row.efactura.state));
