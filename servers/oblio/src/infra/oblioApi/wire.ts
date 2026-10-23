import { DECIMAL_TEXT, exactNumberText, issuesText } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { apiError, DRIFT, fail } from "../../domain/errors.js";
import type {
  WireClientOut,
  WireCollectOut,
  WireCompany,
  WireDeleted,
  WireDocumentOut,
  WireEinvoiceStatus,
  WireIssued,
  WireListedInvoice,
  WireProductOut,
  WireSeries,
  WireStock,
  WireVatRate,
} from "../../domain/schema.js";

/**
 * The zod twins of domain/schema.ts, and the one place a response is parsed
 * (by oblioApi.ts, its only user).
 *
 * Each schema is typed `z.ZodType<Wire...>`, so the compiler holds it to the
 * modelled type: the claim in schema.ts and the check here cannot drift apart.
 * Unknown keys are dropped, not relayed; a documented key with the wrong type,
 * or a required one missing, fails the call with reason `drift`.
 */

const flagIn = z.union([z.boolean(), z.literal(0), z.literal(1), z.literal("0"), z.literal("1")]);

const decimalIn = z.union([
  z.string().regex(DECIMAL_TEXT),
  // A bare number only if it provably survived JSON parsing (exactNumberText).
  z.number().refine((n) => exactNumberText(n) !== undefined, "a number too precise to have survived JSON parsing"),
]);

/** Optional decimals may also come back as "" for a field nobody filled. */
const optionalDecimal = z.union([decimalIn, z.literal("")]).nullish();

const text = z.string().nullish();

const company: z.ZodType<WireCompany> = z.object({
  cif: z.string(),
  company: z.string(),
  userTypeAccess: text,
  useStock: flagIn.nullish(),
});

const vatRate: z.ZodType<WireVatRate> = z.object({ name: z.string(), percent: decimalIn, default: flagIn.nullish() });

const clientOut: z.ZodType<WireClientOut> = z.object({
  clientId: text,
  cif: text,
  name: z.string(),
  rc: text,
  code: text,
  address: text,
  state: text,
  city: text,
  country: text,
  iban: text,
  bank: text,
  email: text,
  phone: text,
  contact: text,
  vatPayer: flagIn.nullish(),
});

const stock: z.ZodType<WireStock> = z.object({
  workStation: text,
  management: text,
  quantity: optionalDecimal,
  price: optionalDecimal,
  currency: text,
  vatName: text,
  vatPercentage: optionalDecimal,
  vatIncluded: flagIn.nullish(),
});

const productOut: z.ZodType<WireProductOut> = z.object({
  name: z.string(),
  code: text,
  description: text,
  measuringUnit: text,
  productType: text,
  price: optionalDecimal,
  currency: text,
  vatName: text,
  vatPercentage: optionalDecimal,
  vatIncluded: flagIn.nullish(),
  stock: z.array(stock).nullish(),
});

const series: z.ZodType<WireSeries> = z.object({
  type: z.string(),
  name: z.string(),
  start: z.union([z.string(), z.number()]).nullish(),
  next: z.union([z.string(), z.number()]).nullish(),
  default: flagIn.nullish(),
});

const collectOut: z.ZodType<WireCollectOut> = z.object({
  issueDate: text,
  type: text,
  number: text,
  value: optionalDecimal,
});

const docNumber = z.union([z.string().min(1), z.number().int()]);

const issued: z.ZodType<WireIssued> = z.object({
  seriesName: z.string().min(1),
  number: docNumber,
  link: text,
  einvoice: text,
});

const documentOut: z.ZodType<WireDocumentOut> = z.object({
  documentType: text,
  seriesName: z.string().min(1),
  number: docNumber,
  link: text,
  einvoice: text,
  total: optionalDecimal,
  collects: z.array(collectOut).nullish(),
});

const einvoiceStatus: z.ZodType<WireEinvoiceStatus> = z.object({
  text,
  sent: flagIn.nullish(),
  code: z.union([z.number().int(), z.string().regex(/^-?[0-9]{1,3}$/)]),
});

/** Oblio's ids are digits ("105595937"); a cursor compares them as integers. */
const docId = z.union([z.string().regex(/^[0-9]{1,20}$/), z.number().int().nonnegative()]);

/**
 * A payment on a listed invoice. Stricter than on the document view: the
 * guard against recording a payment twice compares type, value and date, so a
 * row without them is drift, never a payment that silently matches nothing.
 */
const listedCollect: z.ZodType<WireCollectOut> = z.object({
  issueDate: z.string().min(1),
  type: z.string().min(1),
  number: text,
  value: decimalIn,
});

const listedInvoice: z.ZodType<WireListedInvoice> = z.object({
  id: docId,
  canceled: flagIn,
  seriesName: z.string().min(1),
  number: docNumber,
  issueDate: z.string().min(1),
  dueDate: text,
  currency: z.string().min(1),
  exchangeRate: optionalDecimal,
  total: decimalIn,
  link: text,
  einvoiceStatus: einvoiceStatus.nullish(),
  client: clientOut.nullish(),
  collects: z.array(listedCollect).nullish(),
});

const deleted: z.ZodType<WireDeleted> = z.object({ documentType: text, seriesName: z.string().min(1), number: docNumber });

export const WIRE = {
  companies: z.array(company),
  vatRates: z.array(vatRate),
  clients: z.array(clientOut),
  products: z.array(productOut),
  series: z.array(series),
  issued,
  document: documentOut,
  invoiceList: z.array(listedInvoice),
  deleted,
} as const;

/**
 * Unwrap Oblio's envelope and parse `data` against the endpoint's schema.
 * Anything else is drift, reported with the endpoint and the offending paths.
 */
export const parseData = <T>(schema: z.ZodType<T>, body: unknown, endpoint: string): T => {
  const parsed = z.object({ data: schema }).safeParse(body);
  if (parsed.success) return parsed.data.data;
  return fail(
    apiError(200, `Oblio's answer to ${endpoint} is not the documented shape: ${issuesText(parsed.error)}`, {
      reason: DRIFT,
      body,
    }),
  );
};
