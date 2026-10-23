import { compact, compare, exactNumberText, parseDecimal, ZERO } from "@foreverworks/mcp-kit";

import { required } from "../../domain/errors.js";
import type {
  Client,
  Company,
  DocumentView,
  Efactura,
  EfacturaState,
  Issued,
  ListedInvoice,
  Payment,
  Product,
  Series,
  StockEntry,
  VatRate,
} from "../../domain/models.js";
import type {
  Maybe,
  WireClientOut,
  WireCollectOut,
  WireCompany,
  WireDecimalIn,
  WireDocumentOut,
  WireEinvoiceStatus,
  WireFlagIn,
  WireIssued,
  WireListedInvoice,
  WireProductOut,
  WireSeries,
  WireStock,
  WireVatRate,
} from "../../domain/schema.js";

/**
 * Oblio's records, parsed (wire.ts beside this), turned into this server's models. The
 * rules are in domain/models.ts; each helper below is one of them.
 */

/** Null, absent and "" are all "nobody filled this in". */
const text = (value: Maybe<string>): string | undefined =>
  value === null || value === undefined || value.trim() === "" ? undefined : value;

/** Absent stays absent: a flag Oblio did not send is not `false`. */
const flag = (value: Maybe<WireFlagIn>): boolean | undefined =>
  value === null || value === undefined ? undefined : value === true || value === 1 || value === "1";

/** wire.ts admitted a number only if exactNumberText trusts it, so that text is exact. */
const decimal = (value: Maybe<WireDecimalIn>): string | undefined =>
  value === null || value === undefined || value === "" ? undefined : typeof value === "string" ? value : exactNumberText(value);

/** A series number is text; a bare number (seen on reference documents) loses no padding it never had. */
const numberText = (value: string | number): string => String(value);

export const toCompany = (w: WireCompany): Company =>
  compact({ cif: w.cif, name: w.company, access: text(w.userTypeAccess), useStock: flag(w.useStock) });

export const toVatRate = (w: WireVatRate): VatRate => ({
  name: w.name,
  // Required by wire.ts, so never invented here: missing is not zero.
  percent: required(decimal(w.percent), "VAT rate percent"),
  isDefault: flag(w.default) ?? false,
});

export const toClient = (w: WireClientOut): Client =>
  compact({
    name: w.name,
    cif: text(w.cif),
    rc: text(w.rc),
    code: text(w.code),
    address: text(w.address),
    state: text(w.state),
    city: text(w.city),
    country: text(w.country),
    iban: text(w.iban),
    bank: text(w.bank),
    email: text(w.email),
    phone: text(w.phone),
    contact: text(w.contact),
    vatPayer: flag(w.vatPayer),
  });

const toStock = (w: WireStock): StockEntry =>
  compact({
    workStation: text(w.workStation),
    management: text(w.management),
    quantity: decimal(w.quantity),
    price: decimal(w.price),
    currency: text(w.currency),
    vatName: text(w.vatName),
    vatPercentage: decimal(w.vatPercentage),
    vatIncluded: flag(w.vatIncluded),
  });

export const toProduct = (w: WireProductOut): Product =>
  compact({
    name: w.name,
    code: text(w.code),
    description: text(w.description),
    measuringUnit: text(w.measuringUnit),
    productType: text(w.productType),
    price: decimal(w.price),
    currency: text(w.currency),
    vatName: text(w.vatName),
    vatPercentage: decimal(w.vatPercentage),
    vatIncluded: flag(w.vatIncluded),
    stock: w.stock === null || w.stock === undefined || w.stock.length === 0 ? undefined : w.stock.map(toStock),
  });

export const toSeries = (w: WireSeries): Series =>
  compact({
    type: w.type,
    name: w.name,
    start: w.start === null || w.start === undefined ? undefined : numberText(w.start),
    next: w.next === null || w.next === undefined ? undefined : numberText(w.next),
    isDefault: flag(w.default) ?? false,
  });

const toPayment = (w: WireCollectOut): Payment =>
  compact({ issueDate: text(w.issueDate), type: text(w.type), number: text(w.number), value: decimal(w.value) });

export const toDocumentView = (w: WireDocumentOut): DocumentView =>
  compact({
    documentType: text(w.documentType),
    seriesName: w.seriesName,
    number: numberText(w.number),
    link: text(w.link),
    einvoice: text(w.einvoice),
    total: decimal(w.total),
    collects: w.collects === null || w.collects === undefined ? undefined : w.collects.map(toPayment),
  });

export const toIssued = (w: WireIssued): Issued =>
  compact({ seriesName: w.seriesName, number: numberText(w.number), link: text(w.link), einvoice: text(w.einvoice) });

/** "Trimite factura in SPV": -1 not sent, 0 being processed, 1 sent, 2 has errors and was not sent. */
const EFACTURA_CODES: Readonly<Record<string, EfacturaState>> = { "-1": "not_sent", "0": "processing", "1": "sent", "2": "errors" };

const toEfactura = (w: WireEinvoiceStatus): Efactura => {
  const code = Number(w.code);
  return compact({ state: EFACTURA_CODES[String(code)], code, text: text(w.text) });
};

/** A RON invoice carries "exchangeRate": "0.000000", which is no rate at all. */
const rateOf = (value: Maybe<WireDecimalIn>): string | undefined => {
  const rate = decimal(value);
  const parsed = rate === undefined ? undefined : parseDecimal(rate);
  return parsed === undefined || compare(parsed, ZERO) === 0 ? undefined : rate;
};

export const toListedInvoice = (w: WireListedInvoice): ListedInvoice =>
  compact({
    id: String(w.id),
    seriesName: w.seriesName,
    number: numberText(w.number),
    issueDate: w.issueDate,
    dueDate: text(w.dueDate),
    currency: w.currency,
    exchangeRate: rateOf(w.exchangeRate),
    total: required(decimal(w.total), "invoice total"),
    cancelled: flag(w.canceled) ?? false,
    client:
      w.client === null || w.client === undefined
        ? undefined
        : compact({ name: w.client.name, cif: text(w.client.cif), code: text(w.client.code), email: text(w.client.email) }),
    collects: w.collects === null || w.collects === undefined || w.collects.length === 0 ? undefined : w.collects.map(toPayment),
    efactura: w.einvoiceStatus === null || w.einvoiceStatus === undefined ? undefined : toEfactura(w.einvoiceStatus),
    link: text(w.link),
  });
