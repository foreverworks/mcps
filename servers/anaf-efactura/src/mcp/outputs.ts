import { z } from "zod";

/**
 * What a tool answers, as an MCP output schema, for the tools whose result a
 * program acts on: a client gets the result as typed structured content beside
 * the JSON text, and the guard fails a result that drifts from it
 * (packages/mcp-kit, serve/guard.ts). The controllers declare their results as
 * these types (the kit's OutputOf), so a use case that stops filling a field
 * fails the typecheck. Every value an invoice carries is its text, never a
 * number.
 */

const text = z.string();
const texts = z.array(z.string());

const fileRead = z.strictObject({ name: text, size: z.number().int(), sha256: text, path: text.optional() });

const address = z.strictObject({
  street: text.optional(),
  additionalStreet: text.optional(),
  city: text.optional(),
  postalCode: text.optional(),
  countrySubentity: text.optional(),
  line: text.optional(),
  country: text.optional(),
});

const party = z.strictObject({
  name: text.optional(),
  tradingName: text.optional(),
  vatId: text.optional(),
  taxRegistrationId: text.optional(),
  legalId: text.optional(),
  legalForm: text.optional(),
  identifiers: texts.optional(),
  endpoint: text.optional(),
  address: address.optional(),
  contact: z.strictObject({ name: text.optional(), phone: text.optional(), email: text.optional() }).optional(),
});

const allowanceCharge = z.strictObject({
  charge: z.boolean(),
  amount: text.optional(),
  baseAmount: text.optional(),
  percent: text.optional(),
  reason: text.optional(),
  reasonCode: text.optional(),
  vatCategory: text.optional(),
  vatPercent: text.optional(),
});

const period = z.strictObject({ start: text.optional(), end: text.optional() });

const line = z.strictObject({
  id: text.optional(),
  quantity: text.optional(),
  unitCode: text.optional(),
  netAmount: text.optional(),
  name: text.optional(),
  description: text.optional(),
  sellerItemId: text.optional(),
  buyerItemId: text.optional(),
  standardItemId: text.optional(),
  classifications: texts.optional(),
  originCountry: text.optional(),
  properties: z.array(z.strictObject({ name: text.optional(), value: text.optional() })).optional(),
  price: text.optional(),
  priceBaseQuantity: text.optional(),
  vatCategory: text.optional(),
  vatPercent: text.optional(),
  note: text.optional(),
  period: period.optional(),
  orderLineId: text.optional(),
  allowancesCharges: z.array(allowanceCharge).optional(),
});

export const INVOICE_VIEW = z.strictObject({
  syntax: z.literal("UBL"),
  document: z.enum(["invoice", "credit note"]),
  customizationId: text.optional(),
  profileId: text.optional(),
  number: text.optional(),
  issueDate: text.optional(),
  typeCode: text.optional(),
  currency: text.optional(),
  taxCurrency: text.optional(),
  taxPointDate: text.optional(),
  notes: texts.optional(),
  buyerReference: text.optional(),
  orderReference: text.optional(),
  contractReference: text.optional(),
  projectReference: text.optional(),
  accountingCost: text.optional(),
  precedingInvoices: z.array(z.strictObject({ number: text.optional(), issueDate: text.optional() })).optional(),
  invoicePeriod: period.optional(),
  seller: party,
  buyer: party,
  payee: party.optional(),
  taxRepresentative: party.optional(),
  delivery: z
    .strictObject({ date: text.optional(), locationId: text.optional(), address: address.optional(), partyName: text.optional() })
    .optional(),
  payment: z
    .strictObject({
      dueDate: text.optional(),
      terms: text.optional(),
      means: z
        .array(
          z.strictObject({
            code: text.optional(),
            name: text.optional(),
            paymentIds: texts.optional(),
            account: z.strictObject({ id: text.optional(), name: text.optional(), bank: text.optional() }).optional(),
            cardNumber: text.optional(),
            mandate: z.strictObject({ id: text.optional(), payerAccount: text.optional() }).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  allowancesCharges: z.array(allowanceCharge).optional(),
  vat: z
    .strictObject({
      total: text.optional(),
      totalInTaxCurrency: z.strictObject({ amount: text.optional(), currency: text.optional() }).optional(),
      breakdown: z
        .array(
          z.strictObject({
            category: text.optional(),
            percent: text.optional(),
            taxable: text.optional(),
            tax: text.optional(),
            exemptionReason: text.optional(),
            exemptionReasonCode: text.optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  totals: z
    .strictObject({
      lines: text.optional(),
      taxExclusive: text.optional(),
      taxInclusive: text.optional(),
      allowances: text.optional(),
      charges: text.optional(),
      prepaid: text.optional(),
      rounding: text.optional(),
      payable: text.optional(),
    })
    .optional(),
  lines: z.array(line),
});

export const PARSE_OUTPUT = z.strictObject({
  file: fileRead.optional().describe("The file read, when the document came as xml"),
  archive: z.strictObject({ path: text, sha256: text, bytes: z.number().int() }).optional().describe("The archive read, when it came from the outbox"),
  invoice: INVOICE_VIEW,
});

const facts = z.strictObject({
  syntax: z.enum(["UBL", "CII"]),
  document: z.enum(["invoice", "credit note"]),
  number: text.optional(),
  issueDate: text.optional(),
  seller: z.strictObject({ name: text.optional(), cif: text.optional() }),
  buyer: z.strictObject({ name: text.optional(), cif: text.optional() }),
  payable: text.optional(),
  currency: text.optional(),
  accounts: texts,
});

export const BUILD_OUTPUT = z.strictObject({
  path: text.describe("The built file in the outbox: give it to validate_invoice and upload_invoice as xml: { path }"),
  bytes: z.number().int(),
  sha256: text,
  invoice: facts.describe("The file read back the way upload_invoice reads it for its confirmation line"),
  extern: z.literal(true).optional().describe("The buyer is not Romanian: upload it with extern: true"),
  totals: z.strictObject({
    lines: text,
    vat: text,
    payable: text,
    currency: text,
    vatInRon: text.optional(),
    breakdown: z.array(z.strictObject({ category: text, percent: text, taxable: text, tax: text })),
  }),
});
