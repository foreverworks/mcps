import { exactNumberText, formatDecimal, sub, toDecimal } from "@foreverworks/mcp-kit";

import { fail } from "./errors.js";
import type { CalculationNoteWire, DocumentWire, InvoiceWire, RequestRowWire, RequestSummaryWire } from "./schema.js";

/**
 * What a tool answers, built from the wire shapes: the fields an agent asks
 * about, named once, in the words the portal uses in its own screens. Pure.
 *
 * A filing has two numbers: the portal's (`number`, 2026xxxxxxx, what "Cererile
 * mele" shows first) and the trade register's (`registrationNumber`, what a
 * resolution cites). Both are kept; `id` is what the other tools take.
 */

const kindText = (k: { readonly description?: string | null | undefined; readonly name?: string | null | undefined; readonly code?: string | null | undefined } | null | undefined): string | null =>
  k?.description ?? k?.name ?? k?.code ?? null;

export type RequestView = {
  readonly id: string;
  readonly number: number | null;
  readonly registrationNumber: number | null;
  readonly createdAt: string | null;
  readonly status: string | null;
  readonly type: string | null;
  readonly subtype: string | null;
  readonly flow: string | null;
  readonly company: string | null;
  readonly cui: string | null;
  readonly hasCalculationNote: boolean;
  readonly hasInvoice: boolean;
  readonly cancellable: boolean;
};

export const requestView = (r: RequestRowWire): RequestView => ({
  id: r.id,
  number: r.number ?? null,
  registrationNumber: r.applicationRegistrationNumber ?? null,
  createdAt: r.creationDate ?? null,
  status: r.status ?? null,
  type: kindText(r.applicationFormType),
  subtype: kindText(r.applicationFormSubtype),
  flow: r.name ?? null,
  company: r.companyName ?? null,
  cui: r.identificationCode ?? null,
  hasCalculationNote: r.hasNC === true,
  hasInvoice: r.hasInvoice === true,
  cancellable: r.cancellable === true,
});

export type RequestSummaryView = {
  readonly id: string;
  readonly number: number | null;
  readonly registrationNumber: number | null;
  readonly registeredAt: string | null;
  readonly createdAt: string | null;
  readonly status: string | null;
  readonly statusCode: string | null;
  /** The portal's own words for the status ("Cerere inregistrata"). */
  readonly statusText: string | null;
  readonly type: string | null;
  readonly subtype: string | null;
  readonly flow: string | null;
  readonly register: string | null;
  /** The date by which the office must decide (termen de soluționare). */
  readonly resolutionDue: string | null;
  /** The date the documents are to be released (termen de eliberare). */
  readonly releaseDue: string | null;
  readonly observations: number;
  readonly hasFilesToDownload: boolean;
  readonly hasCalculationNote: boolean;
  readonly allCalculationNotesPaid: boolean;
};

export const requestSummaryView = (s: RequestSummaryWire): RequestSummaryView => ({
  id: s.id,
  number: s.number ?? null,
  registrationNumber: s.requestNumberApp ?? null,
  registeredAt: s.requestDateApp ?? null,
  createdAt: s.creationDate ?? null,
  status: s.status ?? null,
  statusCode: s.statusCode ?? null,
  statusText: s.statusDescription ?? null,
  type: kindText(s.applicationFormType),
  subtype: kindText(s.applicationFormSubtype),
  flow: s.requestTypeFlowName ?? null,
  register: s.appCode ?? null,
  resolutionDue: s.solutionTerm ?? null,
  releaseDue: s.releaseTerm ?? null,
  observations: s.observations?.length ?? 0,
  hasFilesToDownload: s.hasFilesToDownload === true,
  hasCalculationNote: s.hasCalculationNote === true,
  allCalculationNotesPaid: s.hasAllCalculationNotesPayed === true,
});

export type DocumentView = {
  readonly id: string;
  readonly kind: string | null;
  readonly fileName: string | null;
  readonly fileType: string | null;
  readonly pages: number | null;
  readonly signed: boolean;
  readonly viewable: boolean;
  readonly deedNumber: string | null;
  readonly deedDate: string | null;
  readonly issuer: string | null;
};

const dash = (value: string | null | undefined): string | null => (value === undefined || value === null || value.trim() === "-" || value.trim() === "" ? null : value);

export const documentView = (d: DocumentWire): DocumentView => ({
  id: d.id,
  kind: kindText(d.documentTypeOpis),
  fileName: d.fileName ?? null,
  fileType: d.fileType ?? null,
  pages: d.pagesNumber ?? null,
  signed: d.signed === true,
  viewable: d.viewable === true,
  deedNumber: dash(d.deedNumber),
  deedDate: d.deedDate ?? null,
  issuer: dash(d.issuer),
});

export type CalculationNoteView = {
  readonly id: string | null;
  readonly number: string | null;
  readonly date: string | null;
  readonly requestNumber: string | null;
  readonly status: string | null;
  /** Decimal text, as the portal wrote the number. */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly dueBy: string | null;
  readonly paidAt: string | null;
};

const asText = (value: string | number | null | undefined): string | null => (value === undefined || value === null ? null : String(value));

/**
 * An amount the portal sends as a bare JSON number, as exact decimal text:
 * money never touches a float here. A number that may already have lost
 * digits in parsing is `drift`, not an approximation shown as exact.
 */
const amountOf = (value: number | null | undefined, what: string): string | null => {
  if (value === undefined || value === null) return null;
  return exactNumberText(value) ?? fail({ kind: "drift", message: `${what} ${value} is not an exact decimal` });
};

export const calculationNoteView = (n: CalculationNoteWire): CalculationNoteView => ({
  id: n.id ?? null,
  number: asText(n.calculationNoteNumber ?? n.number),
  date: n.calculationNoteDate ?? n.creationDate ?? null,
  requestNumber: asText(n.requestNumber),
  status: n.paymentStatus ?? n.status ?? null,
  amount: amountOf(n.totalValue ?? n.amount, "a calculation note's amount"),
  currency: n.currency ?? null,
  dueBy: n.expirationDate ?? null,
  paidAt: n.paymentDate ?? null,
});

export type InvoiceView = {
  readonly id: string | null;
  readonly number: string | null;
  readonly date: string | null;
  readonly status: string | null;
  /** Decimal text, as the portal wrote the numbers; outstanding is total minus paid, exactly. */
  readonly total: string | null;
  readonly paid: string | null;
  readonly outstanding: string | null;
  readonly currency: string | null;
};

export const invoiceView = (i: InvoiceWire): InvoiceView => {
  const total = amountOf(i.total, "an invoice's total");
  const paid = amountOf(i.paidValue, "an invoice's paid value");
  return {
    id: i.id ?? null,
    number: asText(i.invoiceNumber),
    date: i.date ?? i.creationDate ?? null,
    status: i.status ?? null,
    total,
    paid,
    outstanding: total === null ? null : formatDecimal(sub(toDecimal(total), toDecimal(paid ?? "0"))),
    currency: i.currency ?? null,
  };
};
