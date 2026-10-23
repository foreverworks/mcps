import { compact, DECIMAL_TEXT, iban, isIsoDate } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Target } from "../app/usecases/documents.js";
import {
  clientCodeProblem,
  COLLECT_TYPES,
  type DocumentDraft,
  type DocumentRef,
  type FromProformaDraft,
  type InvoiceDraft,
  PRODUCT_TYPES,
  parseRef,
} from "../domain/document.js";

/**
 * The document tools' input, modelled on Oblio's "Parametri document" table
 * (https://www.oblio.eu/api, 2026-09-28) in this server's snake_case. The
 * fields Oblio documents and this does NOT take are listed, with the reason
 * for each, in the README (Document input).
 *
 * The same schemas feed the tools and the policy's summaries, so the line a
 * user confirms is computed from exactly the arguments the call will run with.
 */

export const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * A series name and a document number, checked for their form so that a wrong
 * one (a number pasted into the series, "FCT 0042" in one field, a number with
 * its series still on it) fails here, naming the field, instead of reaching an
 * invoice that is cancelled or deleted. Oblio's series are short codes of
 * letters and digits ("FCT", "FV1"); its numbers are digits, often
 * zero-padded, and stay text.
 */
export const seriesName = (what: string) =>
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, `${what} is a series code like FCT: letters and digits, no spaces, no number`)
    .describe(`${what}, exactly as list_series shows it.`);

export const documentNumber = z
  .string()
  .trim()
  .regex(/^[0-9]{1,10}$/, 'number is the document number alone, digits like "0042", without its series')
  .describe('The document number as text, without its series: "0042" is not 42.');

export const decimalText = (what: string) =>
  z
    .string()
    .trim()
    .regex(DECIMAL_TEXT, `${what} is a plain decimal like 1000 or 12.50: digits, one optional point, no comma, no exponent`)
    .describe(`${what}, as a decimal STRING ("1000.00"), never a number.`);

export const isoDate = (what: string) =>
  z.string().trim().refine(isIsoDate, `${what} is a real date as YYYY-MM-DD`).describe(`${what}, YYYY-MM-DD.`);

const client = z
  .object({
    name: text(200).describe("The company's name, or the person's."),
    cif: text(20)
      .optional()
      .describe("CIF (RO prefix for a VAT payer) or, for a person, CNP; checked by its control digit unless country names another country."),
    rc: text(40).optional().describe("Trade register number, J99/123/2020."),
    code: text(40).optional().describe("The client's code in Oblio's client list."),
    address: text(300).optional(),
    state: text(80).optional().describe("Judet."),
    city: text(80).optional(),
    country: text(80).optional(),
    iban: text(40)
      .refine((value) => iban(value).ok, { message: "iban fails its check digits (a character is wrong or two are swapped)" })
      .optional()
      .describe("Checked by its own check digits."),
    bank: text(80).optional(),
    email: z.email().optional(),
    phone: text(40).optional(),
    contact: text(120).optional().describe("Contact person."),
    vat_payer: z.boolean().optional(),
    save: z.boolean().optional().describe("Update the saved client with these details. Oblio's default: no."),
    autocomplete: z.boolean().optional().describe("Fill a Romanian company's details from its CIF. Oblio's default: no."),
  })
  .superRefine((buyer, ctx) => {
    const problem = buyer.cif === undefined ? undefined : clientCodeProblem(buyer.cif, buyer.country);
    if (problem !== undefined) ctx.addIssue({ code: "custom", path: ["cif"], message: problem });
  })
  .describe("The buyer.");

const product = z.object({
  name: text(250),
  code: text(60).optional(),
  description: text(1000).optional(),
  price: decimalText("Unit price in the document's currency"),
  quantity: decimalText("Quantity").default("1"),
  measuring_unit: text(20).optional().describe('Oblio\'s default: "buc".'),
  vat_name: text(40).optional().describe('The rate\'s name from list_vat_rates, "Normala" and so on.'),
  vat_percentage: decimalText("VAT rate in percent, 21 for 21%"),
  vat_included: z
    .boolean()
    .describe("Whether `price` already includes VAT. Required: Oblio's own default (included) silently turns a net price into a gross one."),
  product_type: z.enum(PRODUCT_TYPES).optional().describe('"Serviciu" for services; the rest need stock enabled.'),
  management: text(80).optional().describe("The stock management (gestiune) goods leave from."),
  save: z.boolean().optional().describe("Save this price as the product's list price. Oblio's default: yes."),
});

const collect = z
  .object({
    type: z.enum(COLLECT_TYPES),
    series_name: seriesName("The receipt series").optional().describe("The receipt series, required for Chitanta."),
    document_number: text(60).optional().describe("The payment's own reference, required for every type but Chitanta."),
    value: decimalText("Amount collected").optional().describe("Oblio's default: the invoice total."),
    issue_date: isoDate("Date collected").optional(),
    mentions: text(500).optional(),
  })
  .describe("Issue the invoice already paid.");

const documentShape = {
  client,
  series_name: seriesName("The series to issue into").describe("A series from list_series, of the document's type."),
  issue_date: isoDate("Issue date").optional().describe("YYYY-MM-DD. Oblio's default: today."),
  due_date: isoDate("Due date").optional(),
  language: z.string().regex(/^[A-Z]{2}$/).optional().describe('Two letters; Oblio\'s default: "RO".'),
  precision: z.number().int().min(2).max(4).default(2).describe("Decimals kept on prices, 2 to 4."),
  currency: z.string().regex(/^[A-Z]{3}$/).default("RON"),
  exchange_rate: decimalText("Exchange rate to RON").optional().describe("Oblio's default: the rate in the company settings."),
  products: z.array(product).min(1).max(200),
  mentions: text(2000).optional().describe("Printed on the document."),
  internal_note: text(2000).optional().describe("Not shown to the client."),
  issuer_name: text(120).optional().describe("Intocmit de."),
  work_station: text(80).optional().describe('Oblio\'s default: "Sediu".'),
  send_email: z.boolean().optional().describe("Oblio emails the document to the client (client.email, else the one saved in Oblio); the answer's emailedTo says where. Default: no."),
  order_number: text(60).optional().describe("The buyer's order reference, BT-13 on the e-Factura."),
  contract_number: text(60).optional().describe("The contract reference, BT-12 on the e-Factura."),
  idempotency_key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:-]{1,64}$/, "idempotency_key is the key a previous answer reported, copied whole: letters, digits, . _ : -")
    .optional()
    .describe(
      "Oblio refuses a second document with the same key. Leave it out: the key is then derived from the document's " +
        "content and issue date, so an identical retry cannot issue twice. Give one only to issue a second, deliberately " +
        "identical document the same day, or to retry with the key an outcome_unknown failure reported.",
    ),
};

const invoiceShape = {
  ...documentShape,
  delivery_date: isoDate("Delivery date").optional(),
  collect_date: isoDate("Collection date").optional(),
  collect: collect.optional(),
  use_stock: z.boolean().optional().describe("Take the goods out of stock, with stock enabled."),
};

export const PROFORMA_INPUT = documentShape;
export const INVOICE_INPUT = invoiceShape;
export const proformaArgs = z.object(documentShape);
export const invoiceArgs = z.object(invoiceShape);
export type ProformaArgs = z.infer<typeof proformaArgs>;
export type InvoiceArgs = z.infer<typeof invoiceArgs>;

export const REF_INPUT = {
  series_name: seriesName("The document's series"),
  number: documentNumber,
};
export const refArgs = z.object(REF_INPUT);

/** Cancel, restore, delete: an invoice by series and number, and what the caller expects it to total. */
export const ACT_INPUT = {
  ...REF_INPUT,
  expect_total: decimalText("The invoice's total as the caller knows it")
    .optional()
    .describe("The total the invoice must have (\"121.00\"); when it differs nothing is changed. Recommended: a number can name the wrong invoice."),
};
export const actArgs = z.object(ACT_INPUT);

export const FROM_PROFORMA_INPUT = {
  proforma_series: REF_INPUT.series_name,
  proforma_number: REF_INPUT.number,
  invoice_series: seriesName("The INVOICE series to issue into").describe("The INVOICE series to issue into, from list_series."),
  idempotency_key: documentShape.idempotency_key,
};
export const fromProformaArgs = z.object(FROM_PROFORMA_INPUT);

export const toProformaDraft = (a: ProformaArgs): DocumentDraft => ({
  ...compact({
    issueDate: a.issue_date,
    dueDate: a.due_date,
    language: a.language,
    exchangeRate: a.exchange_rate,
    mentions: a.mentions,
    internalNote: a.internal_note,
    issuerName: a.issuer_name,
    workStation: a.work_station,
    sendEmail: a.send_email,
    orderNumber: a.order_number,
    contractNumber: a.contract_number,
    idempotencyKey: a.idempotency_key,
  }),
  client: compact({
    name: a.client.name,
    cif: a.client.cif,
    rc: a.client.rc,
    code: a.client.code,
    address: a.client.address,
    state: a.client.state,
    city: a.client.city,
    country: a.client.country,
    iban: a.client.iban,
    bank: a.client.bank,
    email: a.client.email,
    phone: a.client.phone,
    contact: a.client.contact,
    vatPayer: a.client.vat_payer,
    save: a.client.save,
    autocomplete: a.client.autocomplete,
  }),
  seriesName: a.series_name,
  precision: a.precision,
  currency: a.currency,
  products: a.products.map((p) =>
    compact({
      name: p.name,
      code: p.code,
      description: p.description,
      price: p.price,
      quantity: p.quantity,
      measuringUnit: p.measuring_unit,
      vatName: p.vat_name,
      vatPercentage: p.vat_percentage,
      vatIncluded: p.vat_included,
      productType: p.product_type,
      management: p.management,
      save: p.save,
    }),
  ),
});

export const toInvoiceDraft = (a: InvoiceArgs): InvoiceDraft => ({
  ...toProformaDraft(a),
  ...compact({
    deliveryDate: a.delivery_date,
    collectDate: a.collect_date,
    useStock: a.use_stock,
    collect:
      a.collect === undefined
        ? undefined
        : compact({
            type: a.collect.type,
            seriesName: a.collect.series_name,
            documentNumber: a.collect.document_number,
            value: a.collect.value,
            issueDate: a.collect.issue_date,
            mentions: a.collect.mentions,
          }),
  }),
});

export const toRef = (a: z.infer<typeof refArgs>): DocumentRef => parseRef(a.series_name, a.number);

export const toTarget = (a: z.infer<typeof actArgs>): Target => ({ ref: toRef(a), ...compact({ expectTotal: a.expect_total }) });

export const toFromProformaDraft = (a: z.infer<typeof fromProformaArgs>): FromProformaDraft => ({
  invoiceSeries: a.invoice_series,
  proforma: parseRef(a.proforma_series, a.proforma_number),
  ...compact({ idempotencyKey: a.idempotency_key }),
});
