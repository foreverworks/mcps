import { DECIMAL_TEXT } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { INVOICE_TYPE_CODES, VAT_CATEGORIES } from "../domain/invoiceBuild/codes.js";
import type { BuildParty, InvoiceDraft } from "../domain/invoiceBuild.js";

/**
 * build_invoice's arguments: the invoice as fields, in the words a person uses,
 * mapped to the domain's draft (domain/invoiceBuild.ts). Every amount is a
 * decimal string checked by a pattern: a JSON number has lost digits before
 * anything here could see it.
 */

const decimal = z.string().regex(DECIMAL_TEXT, "a decimal string, e.g. \"2\" or \"-1.5\"");
const unsigned = z.string().regex(/^\d{1,15}(\.\d{1,8})?$/, "a decimal string that is not negative, e.g. \"150.00\"");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const words = (max: number) => z.string().trim().min(1).max(max);

const address = z
  .object({
    street: words(150).describe("Street and number."),
    additional_street: words(100).optional(),
    city: words(50).describe("In Bucharest, the sector: \"Sector 3\" is written SECTOR3."),
    postal_code: words(20).optional(),
    county: z.string().optional().describe("For a Romanian address, required: the county code, CJ or RO-CJ; B for Bucharest."),
    country: z.string().default("RO").describe("ISO 3166-1 alpha-2, RO by default."),
  })
  .describe("The party's postal address.");

const party = (companyId: string) =>
  z.object({
    name: words(200).describe("The registered name."),
    trading_name: words(200).optional(),
    vat_id: z
      .string()
      .optional()
      .describe("The VAT id: RO and the CIF for a Romanian VAT payer (checked by its control digit), or a foreign VAT id."),
    company_id: z.string().optional().describe(companyId),
    address,
    contact: z.object({ name: words(100).optional(), phone: words(100).optional(), email: words(100).optional() }).optional(),
  });

const seller = party("The trade register number (J99/1234/2020) or EUID.")
  .extend({ legal_form: words(200).optional().describe("Share capital and the like, e.g. \"Capital social 200 RON\".") })
  .describe("The seller: your company.");

const buyer = party("A buyer that is not a VAT payer: its CUI (checked); a person: the CNP, or 0000000000000 when not given.").describe("The buyer.");

const line = z.object({
  name: words(100).describe("What was sold."),
  description: words(200).optional(),
  quantity: decimal.describe("Negative on a line that reverses an earlier invoice."),
  unit_code: z.string().default("H87").describe("UN/ECE Rec. 20: H87 piece (default), C62 one, HUR hour, DAY, MON month, KGM kilogram."),
  price: unsigned.describe("The NET price per unit, in the invoice's currency."),
  vat_category: z
    .enum(VAT_CATEGORIES)
    .default("S")
    .describe("S standard (default), Z zero rated, E exempt, AE reverse charge, G export outside the EU, O outside the scope of VAT."),
  vat_percent: unsigned.default("0").describe("The VAT rate for S (21, 11); 0 for every other category."),
  seller_item_id: words(100).optional(),
  note: words(300).optional(),
});

export const buildInput = {
  number: words(200).describe("The invoice number, series included; it must contain a digit."),
  issue_date: date,
  due_date: date.optional().describe("When payment is due; an amount due needs this or payment terms."),
  type_code: z.enum(INVOICE_TYPE_CODES).default("380").describe("380 invoice (default), 384 corrected, 389 self-billed, 751 for accounting."),
  currency: z.string().default("RON").describe("ISO 4217, RON by default."),
  vat_exchange_rate: unsigned
    .optional()
    .describe("For an invoice not in RON, required: RON for one unit of its currency (bnr's rate); the VAT is then also stated in RON."),
  notes: z.array(words(300)).max(20).default([]),
  buyer_reference: words(200).optional(),
  order_reference: words(200).optional(),
  contract_reference: words(200).optional(),
  preceding_invoice: z
    .object({ number: words(200), issue_date: date.optional() })
    .optional()
    .describe("The invoice this one corrects or reverses."),
  invoice_period: z.object({ start: date.optional(), end: date.optional() }).optional(),
  delivery_date: date.optional(),
  seller,
  buyer,
  payment: z
    .object({
      means_code: z.string().optional().describe("UNTDID 4461: 30 credit transfer (the default with an iban), 42 to a bank account, 10 cash, 48 card."),
      iban: z.string().optional().describe("The account to pay into, checked by its check digits."),
      account_name: words(200).optional(),
      bic: words(11).optional(),
      payment_id: words(140).optional().describe("The reference the payer quotes."),
      terms: words(300).optional().describe("The payment terms in words."),
    })
    .optional(),
  lines: z.array(line).min(1).max(999),
  vat_exemptions: z
    .array(z.object({ category: z.enum(VAT_CATEGORIES), code: words(30).optional(), reason: words(300).optional() }))
    .default([])
    .describe("Why a category carries no VAT: required for E (a VATEX-EU code or the law's words); AE, G and O default to VATEX-EU-AE, -G, -O."),
  file_name: z.string().default("").describe("The file's name in the outbox; by default the invoice number's."),
  save_dir: z.string().default("").describe("A folder INSIDE the outbox (e.g. \"2026-10\"); empty means the outbox itself."),
};

const schema = z.object(buildInput);
export type BuildArgs = z.infer<typeof schema>;

const toParty = (p: BuildArgs["buyer"] & { readonly legal_form?: string | undefined }): BuildParty => ({
  name: p.name,
  tradingName: p.trading_name,
  vatId: p.vat_id,
  companyId: p.company_id,
  legalForm: p.legal_form,
  address: {
    street: p.address.street,
    additionalStreet: p.address.additional_street,
    city: p.address.city,
    postalCode: p.address.postal_code,
    county: p.address.county,
    country: p.address.country,
  },
  contact: p.contact,
});

export const toDraft = (a: BuildArgs): InvoiceDraft => ({
  number: a.number,
  issueDate: a.issue_date,
  dueDate: a.due_date,
  typeCode: a.type_code,
  currency: a.currency,
  vatExchangeRate: a.vat_exchange_rate,
  notes: a.notes,
  buyerReference: a.buyer_reference,
  orderReference: a.order_reference,
  contractReference: a.contract_reference,
  precedingInvoice: a.preceding_invoice === undefined ? undefined : { number: a.preceding_invoice.number, issueDate: a.preceding_invoice.issue_date },
  invoicePeriod: a.invoice_period,
  deliveryDate: a.delivery_date,
  seller: toParty(a.seller),
  buyer: toParty(a.buyer),
  payment:
    a.payment === undefined
      ? undefined
      : {
          meansCode: a.payment.means_code,
          iban: a.payment.iban,
          accountName: a.payment.account_name,
          bic: a.payment.bic,
          paymentId: a.payment.payment_id,
          terms: a.payment.terms,
        },
  lines: a.lines.map((l) => ({
    name: l.name,
    description: l.description,
    quantity: l.quantity,
    unitCode: l.unit_code,
    price: l.price,
    vatCategory: l.vat_category,
    vatPercent: l.vat_percent,
    sellerItemId: l.seller_item_id,
    note: l.note,
  })),
  exemptions: a.vat_exemptions,
});

/** The schema the tool parses with, for a caller that has raw arguments (a script, a test). */
export const parseBuildArgs = (raw: unknown): BuildArgs => schema.parse(raw);
