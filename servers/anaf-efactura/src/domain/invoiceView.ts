import { type Compact, compact } from "@foreverworks/mcp-kit";

import { all, at, attribute, prose, text, texts, type XmlElement, type XmlValue } from "./xmlTree.js";

/**
 * A UBL invoice or credit note as plain JSON (parse_invoice): the parties,
 * the lines, the VAT breakdown, the totals and the payment terms, under names
 * a person reads, each with the EN 16931 business term it carries where one
 * is ambiguous.
 *
 * A view, not a judgement: every value is the text the document holds, amounts
 * included, exactly as written (`1234.50` stays `1234.50`, never a number), and
 * a field the document does not fill is absent rather than empty. Checking the
 * document is validate_invoice's job (ANAF's own rules); reading it is this.
 * CII is not read here: ANAF's validator and PDF take UBL only, and so does this.
 */

export type Address = {
  readonly street?: string;
  readonly additionalStreet?: string;
  readonly city?: string;
  readonly postalCode?: string;
  /** BT-39/BT-54: for a Romanian address, the county as ISO 3166-2 (`RO-CJ`, `RO-B`). */
  readonly countrySubentity?: string;
  readonly line?: string;
  readonly country?: string;
};

export type Contact = { readonly name?: string; readonly phone?: string; readonly email?: string };

export type PartyView = {
  /** The registration name (BT-27/BT-44), else the trading name. */
  readonly name?: string;
  /** BT-28/BT-45, when it differs from `name`. */
  readonly tradingName?: string;
  /** The VAT identifier (BT-31/BT-48), `RO...` for a Romanian VAT payer. */
  readonly vatId?: string;
  /** A tax registration that is not VAT (BT-32): the CUI of a seller who is not a VAT payer. */
  readonly taxRegistrationId?: string;
  /** The legal registration (BT-30/BT-47): the trade register number, or a buyer's CUI or CNP. */
  readonly legalId?: string;
  readonly legalForm?: string;
  readonly identifiers?: readonly string[];
  /** The electronic address (BT-34/BT-49). */
  readonly endpoint?: string;
  readonly address?: Address;
  readonly contact?: Contact;
};

export type AllowanceCharge = {
  /** true for a charge, false for an allowance (a discount). */
  readonly charge: boolean;
  readonly amount?: string;
  readonly baseAmount?: string;
  readonly percent?: string;
  readonly reason?: string;
  readonly reasonCode?: string;
  readonly vatCategory?: string;
  readonly vatPercent?: string;
};

export type Period = { readonly start?: string; readonly end?: string };

export type LineView = {
  readonly id?: string;
  readonly quantity?: string;
  /** UN/ECE Recommendation 20 (`H87` piece, `HUR` hour, `KGM` kilogram). */
  readonly unitCode?: string;
  /** BT-131, the line's net amount. */
  readonly netAmount?: string;
  readonly name?: string;
  readonly description?: string;
  readonly sellerItemId?: string;
  readonly buyerItemId?: string;
  readonly standardItemId?: string;
  readonly classifications?: readonly string[];
  readonly originCountry?: string;
  readonly properties?: readonly { readonly name?: string; readonly value?: string }[];
  /** BT-146, the net price per `priceBaseQuantity` (1 when absent). */
  readonly price?: string;
  readonly priceBaseQuantity?: string;
  readonly vatCategory?: string;
  readonly vatPercent?: string;
  readonly note?: string;
  readonly period?: Period;
  readonly orderLineId?: string;
  readonly allowancesCharges?: readonly AllowanceCharge[];
};

export type VatBreakdown = {
  /** UNTDID 5305: S standard, Z zero, E exempt, AE reverse charge, K intra-EU, G export, O outside scope. */
  readonly category?: string;
  readonly percent?: string;
  readonly taxable?: string;
  readonly tax?: string;
  readonly exemptionReason?: string;
  readonly exemptionReasonCode?: string;
};

export type PaymentMeans = {
  /** UNTDID 4461: 30 credit transfer, 31 debit transfer, 42 to a bank account, 10 cash, 48 card, 58 SEPA transfer. */
  readonly code?: string;
  readonly name?: string;
  readonly paymentIds?: readonly string[];
  /** The payee's account (BT-84), its name and bank. */
  readonly account?: { readonly id?: string; readonly name?: string; readonly bank?: string };
  readonly cardNumber?: string;
  /** A direct debit's mandate and the payer's account (BT-89, BT-91). */
  readonly mandate?: { readonly id?: string; readonly payerAccount?: string };
};

export type InvoiceView = {
  readonly syntax: "UBL";
  readonly document: "invoice" | "credit note";
  readonly customizationId?: string;
  readonly profileId?: string;
  readonly number?: string;
  readonly issueDate?: string;
  /** UNTDID 1001: 380 invoice, 381 credit note, 384 corrected, 389 self-billed, 751 for accounting. */
  readonly typeCode?: string;
  readonly currency?: string;
  /** BT-6, the currency VAT is accounted in (RON when the invoice is in another currency). */
  readonly taxCurrency?: string;
  readonly taxPointDate?: string;
  readonly notes?: readonly string[];
  readonly buyerReference?: string;
  readonly orderReference?: string;
  readonly contractReference?: string;
  readonly projectReference?: string;
  readonly accountingCost?: string;
  /** BT-25/BT-26: the invoices this one corrects or reverses. */
  readonly precedingInvoices?: readonly { readonly number?: string; readonly issueDate?: string }[];
  readonly invoicePeriod?: Period;
  readonly seller: PartyView;
  readonly buyer: PartyView;
  readonly payee?: PartyView;
  readonly taxRepresentative?: PartyView;
  readonly delivery?: { readonly date?: string; readonly locationId?: string; readonly address?: Address; readonly partyName?: string };
  readonly payment?: { readonly dueDate?: string; readonly terms?: string; readonly means?: readonly PaymentMeans[] };
  readonly allowancesCharges?: readonly AllowanceCharge[];
  readonly vat?: {
    /** BT-110, in the invoice's currency. */
    readonly total?: string;
    /** BT-111, in the VAT accounting currency, when the document gives it. */
    readonly totalInTaxCurrency?: { readonly amount?: string; readonly currency?: string };
    readonly breakdown?: readonly VatBreakdown[];
  };
  readonly totals?: {
    readonly lines?: string;
    readonly taxExclusive?: string;
    readonly taxInclusive?: string;
    readonly allowances?: string;
    readonly charges?: string;
    readonly prepaid?: string;
    readonly rounding?: string;
    readonly payable?: string;
  };
  readonly lines: readonly LineView[];
};

export type InvoiceViewReading = { readonly kind: "view"; readonly view: InvoiceView } | { readonly kind: "unreadable"; readonly why: string };

/** An object with its absent fields dropped, or undefined when nothing is left: a field the document does not fill is not there. */
const filled = <T extends object>(value: T): Compact<T> | undefined => {
  const kept = compact(value);
  return Object.keys(kept).length === 0 ? undefined : kept;
};

/** A list, or undefined when it is empty. */
const listed = <T>(values: readonly (T | undefined)[]): readonly T[] | undefined => {
  const kept = values.filter((v): v is T => v !== undefined);
  return kept.length === 0 ? undefined : kept;
};

const address = (node: XmlValue | undefined): Address | undefined =>
  filled({
    street: text(at(node, "StreetName")),
    additionalStreet: text(at(node, "AdditionalStreetName")),
    city: text(at(node, "CityName")),
    postalCode: text(at(node, "PostalZone")),
    countrySubentity: text(at(node, "CountrySubentity")),
    line: text(at(node, "AddressLine", "Line")),
    country: text(at(node, "Country", "IdentificationCode")),
  });

/** A PartyTaxScheme is the VAT one when its scheme says VAT, which is what EN 16931 binds BT-31 to. */
const isVat = (scheme: XmlValue): boolean => text(at(scheme, "TaxScheme", "ID"))?.toUpperCase() === "VAT";

const party = (node: XmlValue | undefined): PartyView => {
  const schemes = all(at(node, "PartyTaxScheme"));
  const registrationName = text(at(node, "PartyLegalEntity", "RegistrationName"));
  const tradingName = text(at(node, "PartyName", "Name"));
  return compact({
    name: registrationName ?? tradingName,
    tradingName: registrationName !== undefined && tradingName !== registrationName ? tradingName : undefined,
    vatId: texts(schemes.filter(isVat), "CompanyID")[0],
    taxRegistrationId: texts(
      schemes.filter((s) => !isVat(s)),
      "CompanyID",
    )[0],
    legalId: text(at(node, "PartyLegalEntity", "CompanyID")),
    legalForm: text(at(node, "PartyLegalEntity", "CompanyLegalForm")),
    identifiers: listed(texts(all(at(node, "PartyIdentification")), "ID")),
    endpoint: text(at(node, "EndpointID")),
    address: address(at(node, "PostalAddress")),
    contact: filled({
      name: text(at(node, "Contact", "Name")),
      phone: text(at(node, "Contact", "Telephone")),
      email: text(at(node, "Contact", "ElectronicMail")),
    }),
  }) as PartyView;
};

const allowanceCharge = (node: XmlValue): AllowanceCharge =>
  compact({
    charge: text(at(node, "ChargeIndicator"))?.toLowerCase() === "true",
    amount: text(at(node, "Amount")),
    baseAmount: text(at(node, "BaseAmount")),
    percent: text(at(node, "MultiplierFactorNumeric")),
    reason: prose(at(node, "AllowanceChargeReason")),
    reasonCode: text(at(node, "AllowanceChargeReasonCode")),
    vatCategory: text(at(node, "TaxCategory", "ID")),
    vatPercent: text(at(node, "TaxCategory", "Percent")),
  }) as AllowanceCharge;

const period = (node: XmlValue | undefined): Period | undefined => filled({ start: text(at(node, "StartDate")), end: text(at(node, "EndDate")) });

const line = (node: XmlValue, quantityName: string): LineView => {
  const item = at(node, "Item");
  const quantity = at(node, quantityName);
  return compact({
    id: text(at(node, "ID")),
    quantity: text(quantity),
    unitCode: attribute(quantity, "unitCode"),
    netAmount: text(at(node, "LineExtensionAmount")),
    name: text(at(item, "Name")),
    description: listed(all(at(item, "Description")).map(prose))?.join("\n"),
    sellerItemId: text(at(item, "SellersItemIdentification", "ID")),
    buyerItemId: text(at(item, "BuyersItemIdentification", "ID")),
    standardItemId: text(at(item, "StandardItemIdentification", "ID")),
    classifications: listed(texts(all(at(item, "CommodityClassification")), "ItemClassificationCode")),
    originCountry: text(at(item, "OriginCountry", "IdentificationCode")),
    properties: listed(
      all(at(item, "AdditionalItemProperty")).map((p) => filled({ name: text(at(p, "Name")), value: text(at(p, "Value")) })),
    ),
    price: text(at(node, "Price", "PriceAmount")),
    priceBaseQuantity: text(at(node, "Price", "BaseQuantity")),
    vatCategory: text(at(item, "ClassifiedTaxCategory", "ID")),
    vatPercent: text(at(item, "ClassifiedTaxCategory", "Percent")),
    note: listed(all(at(node, "Note")).map(prose))?.join("\n"),
    period: period(at(node, "InvoicePeriod")),
    orderLineId: text(at(node, "OrderLineReference", "LineID")),
    allowancesCharges: listed(all(at(node, "AllowanceCharge")).map(allowanceCharge)),
  }) as LineView;
};

const paymentMeans = (node: XmlValue): PaymentMeans => {
  const code = at(node, "PaymentMeansCode");
  return compact({
    code: text(code),
    name: attribute(code, "name"),
    paymentIds: listed(all(at(node, "PaymentID")).map(text)),
    account: filled({
      id: text(at(node, "PayeeFinancialAccount", "ID")),
      name: text(at(node, "PayeeFinancialAccount", "Name")),
      bank: text(at(node, "PayeeFinancialAccount", "FinancialInstitutionBranch", "ID")),
    }),
    cardNumber: text(at(node, "CardAccount", "PrimaryAccountNumberID")),
    mandate: filled({
      id: text(at(node, "PaymentMandate", "ID")),
      payerAccount: text(at(node, "PaymentMandate", "PayerFinancialAccount", "ID")),
    }),
  }) as PaymentMeans;
};

const breakdown = (node: XmlValue): VatBreakdown =>
  compact({
    category: text(at(node, "TaxCategory", "ID")),
    percent: text(at(node, "TaxCategory", "Percent")),
    taxable: text(at(node, "TaxableAmount")),
    tax: text(at(node, "TaxAmount")),
    exemptionReason: prose(at(node, "TaxCategory", "TaxExemptionReason")),
    exemptionReasonCode: text(at(node, "TaxCategory", "TaxExemptionReasonCode")),
  }) as VatBreakdown;

/**
 * The VAT totals. A document in another currency carries two TaxTotal
 * elements: one in its own currency with the breakdown, one in the VAT
 * accounting currency (BT-111) with the amount alone. They are told apart by
 * the currency their TaxAmount names, then by which one has a breakdown.
 */
const vat = (root: XmlValue, currency: string | undefined, taxCurrency: string | undefined): InvoiceView["vat"] => {
  const totals = all(at(root, "TaxTotal"));
  const currencyOf = (t: XmlValue) => attribute(at(t, "TaxAmount"), "currencyID");
  const main =
    totals.find((t) => currency !== undefined && currencyOf(t) === currency) ?? totals.find((t) => at(t, "TaxSubtotal") !== undefined) ?? totals[0];
  const accounting = taxCurrency !== undefined && taxCurrency !== currency ? totals.find((t) => t !== main && currencyOf(t) === taxCurrency) : undefined;
  return filled({
    total: text(at(main, "TaxAmount")),
    totalInTaxCurrency: accounting === undefined ? undefined : filled({ amount: text(at(accounting, "TaxAmount")), currency: currencyOf(accounting) }),
    breakdown: listed(all(at(main, "TaxSubtotal")).map(breakdown)),
  });
};

const readUbl = (root: XmlValue, document: InvoiceView["document"]): InvoiceView => {
  const isInvoice = document === "invoice";
  const currency = text(at(root, "DocumentCurrencyCode"));
  const taxCurrency = text(at(root, "TaxCurrencyCode"));
  const means = all(at(root, "PaymentMeans"));
  const totals = at(root, "LegalMonetaryTotal");
  const delivery = at(root, "Delivery");
  return compact({
    syntax: "UBL" as const,
    document,
    customizationId: text(at(root, "CustomizationID")),
    profileId: text(at(root, "ProfileID")),
    number: text(at(root, "ID")),
    issueDate: text(at(root, "IssueDate")),
    typeCode: text(at(root, isInvoice ? "InvoiceTypeCode" : "CreditNoteTypeCode")),
    currency,
    taxCurrency,
    taxPointDate: text(at(root, "TaxPointDate")),
    notes: listed(all(at(root, "Note")).map(prose)),
    buyerReference: text(at(root, "BuyerReference")),
    orderReference: text(at(root, "OrderReference", "ID")),
    contractReference: text(at(root, "ContractDocumentReference", "ID")),
    projectReference: text(at(root, "ProjectReference", "ID")),
    accountingCost: text(at(root, "AccountingCost")),
    precedingInvoices: listed(
      all(at(root, "BillingReference")).map((r) =>
        filled({ number: text(at(r, "InvoiceDocumentReference", "ID")), issueDate: text(at(r, "InvoiceDocumentReference", "IssueDate")) }),
      ),
    ),
    invoicePeriod: period(at(root, "InvoicePeriod")),
    seller: party(at(root, "AccountingSupplierParty", "Party")),
    buyer: party(at(root, "AccountingCustomerParty", "Party")),
    payee: at(root, "PayeeParty") === undefined ? undefined : party(at(root, "PayeeParty")),
    taxRepresentative: at(root, "TaxRepresentativeParty") === undefined ? undefined : party(at(root, "TaxRepresentativeParty")),
    delivery: filled({
      date: text(at(delivery, "ActualDeliveryDate")),
      locationId: text(at(delivery, "DeliveryLocation", "ID")),
      address: address(at(delivery, "DeliveryLocation", "Address")),
      partyName: text(at(delivery, "DeliveryParty", "PartyName", "Name")),
    }),
    payment: filled({
      // BT-9: the invoice's DueDate; a credit note carries it on its payment means.
      dueDate: text(at(root, "DueDate")) ?? texts(means, "PaymentDueDate")[0],
      terms: listed(all(at(root, "PaymentTerms")).flatMap((t) => all(at(t, "Note")).map(prose)))?.join("\n"),
      means: listed(means.map(paymentMeans)),
    }),
    allowancesCharges: listed(all(at(root, "AllowanceCharge")).map(allowanceCharge)),
    vat: vat(root, currency, taxCurrency),
    totals: filled({
      lines: text(at(totals, "LineExtensionAmount")),
      taxExclusive: text(at(totals, "TaxExclusiveAmount")),
      taxInclusive: text(at(totals, "TaxInclusiveAmount")),
      allowances: text(at(totals, "AllowanceTotalAmount")),
      charges: text(at(totals, "ChargeTotalAmount")),
      prepaid: text(at(totals, "PrepaidAmount")),
      rounding: text(at(totals, "PayableRoundingAmount")),
      payable: text(at(totals, "PayableAmount")),
    }),
    lines: all(at(root, isInvoice ? "InvoiceLine" : "CreditNoteLine")).map((l) => line(l, isInvoice ? "InvoicedQuantity" : "CreditedQuantity")),
  }) as InvoiceView;
};

export const viewInvoice = (tree: XmlElement): InvoiceViewReading => {
  if (tree["Invoice"] !== undefined) return { kind: "view", view: readUbl(tree["Invoice"], "invoice") };
  if (tree["CreditNote"] !== undefined) return { kind: "view", view: readUbl(tree["CreditNote"], "credit note") };
  if (tree["CrossIndustryInvoice"] !== undefined) return { kind: "unreadable", why: "the document is CII; parse_invoice reads UBL (Invoice or CreditNote), as ANAF's validator does" };
  const roots = Object.keys(tree).filter((k) => !k.startsWith("?") && !k.startsWith("@_"));
  return { kind: "unreadable", why: `root element ${roots[0] ?? "(none)"} is not a UBL Invoice or CreditNote` };
};
