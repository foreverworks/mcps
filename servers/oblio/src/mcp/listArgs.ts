import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { ListInvoicesArgs } from "../app/usecases/listing.js";
import { LIST_PAGE_MAX } from "../app/usecases/listing.js";
import { fail, inputError } from "../domain/errors.js";
import { INVOICE_STATUSES, type InvoiceFilter, LIST_ORDERS } from "../domain/invoiceList.js";
import { EFACTURA_STATES } from "../domain/models.js";
import { isoDate, seriesName, text } from "./documentArgs.js";

/**
 * list_invoices' input: Oblio's "Parametri listare documente" that a person
 * asks by (https://www.oblio.eu/api, Raport documente), in this server's
 * snake_case, plus the e-Factura state, which the list reports but cannot
 * filter by.
 */
export const LIST_INPUT = {
  issued_after: isoDate("Start of the period").optional().describe("Start of the period, YYYY-MM-DD (Oblio's issuedAfter, its start date)."),
  issued_before: isoDate("End of the period").optional().describe("End of the period, YYYY-MM-DD (Oblio's issuedBefore, its end date)."),
  series_name: seriesName("The invoice series").optional(),
  client_cif: text(20).optional().describe("The buyer's CIF as it is saved in Oblio (list_clients shows it)."),
  client_email: z.email().optional().describe("The buyer's e-mail as it is saved in Oblio."),
  client_code: text(40).optional().describe("The buyer's code in Oblio's client list."),
  status: z
    .enum(INVOICE_STATUSES)
    .optional()
    .describe('"unpaid" or "paid" (collected in Oblio), both without cancelled invoices, or "cancelled". Leave it out for all.'),
  efactura: z
    .array(z.enum(EFACTURA_STATES))
    .min(1)
    .max(EFACTURA_STATES.length)
    .optional()
    .describe(
      'Only invoices in these e-Factura states: "not_sent", "processing" (in SPV, not yet answered), "sent", "errors" ' +
        "(not sent because of errors). Checked page by page after Oblio answers; scanned says how many were read.",
    ),
  order: z.enum(LIST_ORDERS).default("newest").describe("By the order Oblio created the documents in. Default: newest first."),
  limit: z.number().int().min(1).max(LIST_PAGE_MAX).default(50).describe(`Invoices read per page, at most ${LIST_PAGE_MAX}.`),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("The nextCursor of the previous page, with the same filters. Leave it out for the first page."),
};
export const listArgs = z.object(LIST_INPUT);
export type ListArgs = z.infer<typeof listArgs>;

export const toListInvoicesArgs = (a: ListArgs): ListInvoicesArgs => {
  if (a.issued_after !== undefined && a.issued_before !== undefined && a.issued_after > a.issued_before)
    fail(inputError(`issued_after ${a.issued_after} is after issued_before ${a.issued_before}`));
  const client = compact({ cif: a.client_cif, email: a.client_email, code: a.client_code });
  const filter: InvoiceFilter = {
    ...compact({
      issuedAfter: a.issued_after,
      issuedBefore: a.issued_before,
      seriesName: a.series_name,
      status: a.status,
      efactura: a.efactura === undefined ? undefined : [...new Set(a.efactura)].sort(),
    }),
    ...(Object.keys(client).length === 0 ? {} : { client }),
    order: a.order,
  };
  return { filter, limit: a.limit, ...compact({ cursor: a.cursor }) };
};
