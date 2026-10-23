import { compact } from "@foreverworks/mcp-kit";
import type { InvoiceFilter } from "../../domain/invoiceList.js";
import type { ReversalPlan } from "../../domain/reversal.js";
import type {
  Collect,
  DocumentDraft,
  DocumentRef,
  FromProformaDraft,
  InvoiceDraft,
  Party,
  ProductLine,
} from "../../domain/document.js";
import type {
  WireClientIn,
  WireCollectIn,
  WireCollectInvoiceIn,
  WireDocumentIn,
  WireDocumentRefIn,
  WireFlag,
  WireFromProformaIn,
  WireInvoiceIn,
  WireInvoiceListIn,
  WireProductIn,
  WireReversalIn,
  WireTriFlag,
} from "../../domain/schema.js";

/**
 * A draft, as the JSON body Oblio's "Parametri document" table describes.
 *
 * The company CIF is the one argument the draft cannot carry: it comes from
 * app.json, so no caller can issue against another company. Decimals travel as
 * the strings the caller wrote (see WireProductIn), and a boolean becomes the
 * 0 or 1 Oblio documents. An unset option is left OUT, so Oblio applies its
 * own documented default rather than one guessed here.
 */

const flag = (value: boolean): WireFlag => (value ? 1 : 0);
const flagOf = (value: boolean | undefined): WireFlag | undefined => (value === undefined ? undefined : flag(value));

const clientIn = (p: Party): WireClientIn =>
  compact({
    name: p.name,
    cif: p.cif,
    rc: p.rc,
    code: p.code,
    address: p.address,
    state: p.state,
    city: p.city,
    country: p.country,
    iban: p.iban,
    bank: p.bank,
    email: p.email,
    phone: p.phone,
    contact: p.contact,
    vatPayer: flagOf(p.vatPayer),
    save: flagOf(p.save),
    autocomplete: flagOf(p.autocomplete),
  });

const productIn = (l: ProductLine): WireProductIn =>
  compact({
    name: l.name,
    code: l.code,
    description: l.description,
    price: l.price,
    quantity: l.quantity,
    measuringUnit: l.measuringUnit,
    vatName: l.vatName,
    vatPercentage: l.vatPercentage,
    vatIncluded: flag(l.vatIncluded),
    productType: l.productType,
    management: l.management,
    save: flagOf(l.save),
  });

const collectIn = (c: Collect): WireCollectIn =>
  compact({
    type: c.type,
    seriesName: c.seriesName,
    documentNumber: c.documentNumber,
    value: c.value,
    issueDate: c.issueDate,
    mentions: c.mentions,
  });

export const documentIn = (cif: string, d: DocumentDraft): WireDocumentIn =>
  compact({
    cif,
    client: clientIn(d.client),
    issueDate: d.issueDate,
    dueDate: d.dueDate,
    seriesName: d.seriesName,
    language: d.language,
    precision: d.precision,
    currency: d.currency,
    exchangeRate: d.exchangeRate,
    products: d.products.map(productIn),
    issuerName: d.issuerName,
    internalNote: d.internalNote,
    mentions: d.mentions,
    workStation: d.workStation,
    sendEmail: flagOf(d.sendEmail),
    orderNumber: d.orderNumber,
    contractNumber: d.contractNumber,
    idempotencyKey: d.idempotencyKey,
  });

export const invoiceIn = (cif: string, d: InvoiceDraft): WireInvoiceIn => ({
  ...documentIn(cif, d),
  ...compact({
    deliveryDate: d.deliveryDate,
    collectDate: d.collectDate,
    collect: d.collect === undefined ? undefined : collectIn(d.collect),
    useStock: flagOf(d.useStock),
  }),
});

export const fromProformaIn = (cif: string, d: FromProformaDraft): WireFromProformaIn =>
  compact({
    cif,
    seriesName: d.invoiceSeries,
    referenceDocument: { type: "Proforma", seriesName: d.proforma.seriesName, number: d.proforma.number } as const,
    idempotencyKey: d.idempotencyKey,
  });

export const refIn = (cif: string, ref: DocumentRef): WireDocumentRefIn => ({
  cif,
  seriesName: ref.seriesName,
  number: ref.number,
});

/** The status a caller asks for, as Oblio's two independent list flags. */
const statusFlags = (status: InvoiceFilter["status"]): { readonly canceled: WireTriFlag; readonly collected: WireTriFlag } => {
  switch (status) {
    case "unpaid":
      return { canceled: 0, collected: 0 };
    case "paid":
      return { canceled: 0, collected: 1 };
    case "cancelled":
      return { canceled: 1, collected: -1 };
    case undefined:
      return { canceled: -1, collected: -1 };
  }
};

/**
 * The list query. Drafts are never listed (`draft: 0`): a draft is not an
 * issued document. Every flag is sent, -1 included, so no filter rests on a
 * default Oblio does not document. Payments and the SPV state come with every
 * row; ordering is by id, which no two documents share, so offsets page
 * through one fixed order.
 */
export const invoiceListQuery = (
  cif: string,
  q: { readonly filter: InvoiceFilter; readonly offset: number; readonly limit: number },
): WireInvoiceListIn =>
  compact({
    cif,
    seriesName: q.filter.seriesName,
    "client[cif]": q.filter.client?.cif,
    "client[email]": q.filter.client?.email,
    "client[code]": q.filter.client?.code,
    draft: 0 as const,
    ...statusFlags(q.filter.status),
    issuedAfter: q.filter.issuedAfter,
    issuedBefore: q.filter.issuedBefore,
    withCollects: 1 as const,
    withEinvoiceStatus: 1 as const,
    orderBy: "id" as const,
    orderDir: q.filter.order === "newest" ? ("DESC" as const) : ("ASC" as const),
    limitPerPage: q.limit,
    offset: q.offset,
  });

/** One invoice by series and number, whatever its status, with its buyer, payments and SPV state. */
export const findInvoiceQuery = (cif: string, ref: DocumentRef): WireInvoiceListIn => ({
  cif,
  seriesName: ref.seriesName,
  number: ref.number,
  draft: 0,
  canceled: -1,
  collected: -1,
  withCollects: 1,
  withEinvoiceStatus: 1,
  orderBy: "id",
  orderDir: "DESC",
  limitPerPage: 10,
  offset: 0,
});

export const collectInvoiceIn = (cif: string, ref: DocumentRef, payment: Collect, idempotencyKey: string): WireCollectInvoiceIn => ({
  cif,
  seriesName: ref.seriesName,
  number: ref.number,
  collect: collectIn(payment),
  idempotencyKey,
});

export const reversalIn = (
  cif: string,
  plan: Pick<ReversalPlan, "ref" | "seriesName" | "removePayments" | "idempotencyKey">,
): WireReversalIn => ({
  cif,
  seriesName: plan.seriesName,
  referenceDocument: { type: "Factura", seriesName: plan.ref.seriesName, number: plan.ref.number, refund: flag(plan.removePayments) },
  idempotencyKey: plan.idempotencyKey,
});
