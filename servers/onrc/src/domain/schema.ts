import { z } from "zod";

/**
 * The portal's wire shapes, the parts this server reads, as zod loose objects:
 * the portal adds fields between releases and an unknown one is not a
 * failure, while a missing one this server depends on is `drift`.
 *
 * Where each shape comes from (read from the portal's own calls in a
 * signed-in browser):
 * - a filing row and a filing's summary: GET interf/requests/v2 and
 *   interf/requests/{id}/summary, live answers;
 * - a filing's documents: GET interf/opis-documents/complete/{id}, live;
 * - calculation notes and invoices: the envelopes are live
 *   (`{metadata, data}`), the ITEMS were modelled from the portal's own code
 *   (not yet seen in a live answer), so every field of theirs is optional and the
 *   first live answer is the check.
 *
 * Several answers carry the signed-in person's identity document and personal
 * numeric code under `user` / `request.user`. No shape here reads them, and
 * no view repeats them.
 */

const nullableText = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();

/** A nomenclature entry: what kind of filing (Menţiune, Înmatriculare), what kind of document. */
export const kindWire = z.looseObject({ code: nullableText, description: nullableText, name: nullableText, registryCode: nullableText });

export const requestRowWire = z.looseObject({
  id: z.string(),
  number: nullableNumber,
  applicationRegistrationNumber: nullableNumber,
  creationDate: nullableText,
  status: nullableText,
  name: nullableText,
  applicationFormType: kindWire.nullable().optional(),
  applicationFormSubtype: kindWire.nullable().optional(),
  companyName: nullableText,
  identificationCode: nullableText,
  cancellable: nullableBoolean,
  cancellationPending: nullableBoolean,
  hasNC: nullableBoolean,
  hasInvoice: nullableBoolean,
});
export type RequestRowWire = z.infer<typeof requestRowWire>;

/** Spring's page (a slice, in fact: no total): `content` plus where it sits. */
export const springPageWire = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    content: z.array(item),
    number: nullableNumber,
    size: nullableNumber,
    numberOfElements: nullableNumber,
    totalElements: nullableNumber,
    first: nullableBoolean,
    last: nullableBoolean,
  });

export const requestSummaryWire = z.looseObject({
  id: z.string(),
  number: nullableNumber,
  requestNumberApp: nullableNumber,
  requestDateApp: nullableText,
  creationDate: nullableText,
  status: nullableText,
  statusCode: nullableText,
  statusDescription: nullableText,
  appCode: nullableText,
  requestTypeFlowName: nullableText,
  applicationFormType: kindWire.nullable().optional(),
  applicationFormSubtype: kindWire.nullable().optional(),
  solutionTerm: nullableText,
  releaseTerm: nullableText,
  observations: z.array(z.unknown()).nullable().optional(),
  hasFilesToDownload: nullableBoolean,
  hasCalculationNote: nullableBoolean,
  hasAllCalculationNotesPayed: nullableBoolean,
});
export type RequestSummaryWire = z.infer<typeof requestSummaryWire>;

/** The portal's own page envelope (not Spring's): `metadata` with a total, `data`. */
export const portalPageWire = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    metadata: z.looseObject({ page: nullableNumber, size: nullableNumber, pages: nullableNumber, total: nullableNumber }).nullable().optional(),
    data: z.array(item),
  });

export const documentWire = z.looseObject({
  id: z.string(),
  documentTypeOpis: kindWire.nullable().optional(),
  fileName: nullableText,
  fileType: nullableText,
  pagesNumber: nullableNumber,
  signed: nullableBoolean,
  viewable: nullableBoolean,
  deedNumber: nullableText,
  deedDate: nullableText,
  issuer: nullableText,
  startDate: nullableText,
});
export type DocumentWire = z.infer<typeof documentWire>;

export const calculationNoteWire = z.looseObject({
  id: nullableText,
  number: z.union([z.string(), z.number()]).nullable().optional(),
  calculationNoteNumber: z.union([z.string(), z.number()]).nullable().optional(),
  calculationNoteDate: nullableText,
  creationDate: nullableText,
  requestNumber: z.union([z.string(), z.number()]).nullable().optional(),
  status: nullableText,
  paymentStatus: nullableText,
  paymentDate: nullableText,
  amount: nullableNumber,
  totalValue: nullableNumber,
  currency: nullableText,
  expirationDate: nullableText,
});
export type CalculationNoteWire = z.infer<typeof calculationNoteWire>;

export const invoiceWire = z.looseObject({
  id: nullableText,
  invoiceNumber: z.union([z.string(), z.number()]).nullable().optional(),
  date: nullableText,
  creationDate: nullableText,
  status: nullableText,
  total: nullableNumber,
  paidValue: nullableNumber,
  currency: nullableText,
});
export type InvoiceWire = z.infer<typeof invoiceWire>;

/** The invoices answer wraps its page once more: `{ invoices: { metadata, data } }`. */
export const invoicesAnswerWire = z.looseObject({ invoices: portalPageWire(invoiceWire) });
