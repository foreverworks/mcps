import {
  AMOUNT_SCALE,
  cnp,
  compare,
  documentTotal,
  type DocumentTotal,
  formatDecimal,
  iban,
  lineAmount,
  mul,
  round,
  romanianCif,
  toDecimal,
  ZERO,
} from "@foreverworks/mcp-kit";

import {
  BUCHAREST_SECTORS,
  CIUS_RO,
  CREDIT_TRANSFER,
  DEFAULT_EXEMPTION,
  MAX,
  NEEDS_EXEMPTION,
  RO_COUNTIES,
  type VatCategory,
} from "./invoiceBuild/codes.js";
import { el, type XmlNode, xmlDocument } from "./invoiceBuild/xmlWriter.js";

/**
 * A CIUS-RO invoice (UBL 2.1) built from fields (build_invoice).
 *
 * The totals are the kit's documentTotal, the one EN 16931 rule oblio issues
 * by: each line quantity x price rounded to two decimals, VAT once per
 * category and rate on their sum, half away from zero. So the amount a person
 * later confirms when upload_invoice reads this file back is the figure
 * computed here, and the figure ANAF checks (BR-CO-10, BR-CO-17).
 *
 * Before anything is written, `draftProblems` holds the draft to what ANAF
 * would refuse and a person would otherwise find out a day later: check
 * digits (CIF, CNP, IBAN), the address rules (county, Bucharest's sector), the
 * VAT rules per category, the CIUS-RO lengths. ANAF's validator remains the
 * authority (validate_invoice); this catches what can be caught here.
 */

export type BuildAddress = {
  readonly street: string;
  readonly additionalStreet?: string | undefined;
  readonly city: string;
  readonly postalCode?: string | undefined;
  /** For a Romanian address: the county, `CJ` or `RO-CJ`; `B` for Bucharest. */
  readonly county?: string | undefined;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
};

export type BuildParty = {
  readonly name: string;
  readonly tradingName?: string | undefined;
  /** BT-31/BT-48: `RO` and the CIF for a Romanian VAT payer, a foreign VAT id as issued. */
  readonly vatId?: string | undefined;
  /** BT-30/BT-47: the seller's trade register number; a buyer's CUI (not a VAT payer) or a person's CNP. */
  readonly companyId?: string | undefined;
  /** BT-33, the seller's only: share capital and the like. */
  readonly legalForm?: string | undefined;
  readonly address: BuildAddress;
  readonly contact?: { readonly name?: string | undefined; readonly phone?: string | undefined; readonly email?: string | undefined } | undefined;
};

export type BuildLine = {
  readonly name: string;
  readonly description?: string | undefined;
  /** A decimal string; negative on a line that reverses an earlier one. */
  readonly quantity: string;
  /** UN/ECE Recommendation 20: H87 piece, C62 one, HUR hour, DAY, MON month, KGM. */
  readonly unitCode: string;
  /** The net price per unit, a decimal string, never negative (BR-27). */
  readonly price: string;
  readonly vatCategory: VatCategory;
  /** The rate in percent; 0 for every category but S, and not written for O. */
  readonly vatPercent: string;
  readonly sellerItemId?: string | undefined;
  readonly note?: string | undefined;
};

export type BuildPayment = {
  /** UNTDID 4461; 30 (credit transfer) when an IBAN is given and no code is. */
  readonly meansCode?: string | undefined;
  readonly iban?: string | undefined;
  readonly accountName?: string | undefined;
  readonly bic?: string | undefined;
  /** BT-83, the reference the payer quotes. */
  readonly paymentId?: string | undefined;
  /** BT-20, in words. */
  readonly terms?: string | undefined;
};

export type BuildExemption = { readonly category: VatCategory; readonly code?: string | undefined; readonly reason?: string | undefined };

export type InvoiceDraft = {
  readonly number: string;
  readonly issueDate: string;
  readonly dueDate?: string | undefined;
  readonly typeCode: string;
  readonly currency: string;
  /** RON for one unit of `currency`, required when it is not RON: the VAT in RON (BT-111) is the VAT total at this rate. */
  readonly vatExchangeRate?: string | undefined;
  readonly notes: readonly string[];
  readonly buyerReference?: string | undefined;
  readonly orderReference?: string | undefined;
  readonly contractReference?: string | undefined;
  readonly precedingInvoice?: { readonly number: string; readonly issueDate?: string | undefined } | undefined;
  readonly invoicePeriod?: { readonly start?: string | undefined; readonly end?: string | undefined } | undefined;
  readonly deliveryDate?: string | undefined;
  readonly seller: BuildParty;
  readonly buyer: BuildParty;
  readonly payment?: BuildPayment | undefined;
  readonly lines: readonly BuildLine[];
  readonly exemptions: readonly BuildExemption[];
};

/** What a built invoice adds up to: the kit's total, and the VAT in RON when the invoice is in another currency. */
export type BuiltTotals = DocumentTotal & { readonly vatInRon?: string };

// --- normalising what a person writes ----------------------------------------

/** `cj`, `CJ` and `RO-CJ` are one county. */
const countyCode = (county: string | undefined): string | undefined => {
  const plain = county?.trim().toUpperCase().replace(/^RO-/, "");
  return plain === undefined || plain === "" ? undefined : `RO-${plain}`;
};

/** In Bucharest, `Sector 3`, `sector3` and `SECTOR 3` are SECTOR3, as BR-RO-100 spells it. */
const bucharestCity = (city: string): string => {
  const sector = /^\s*sector\s*([1-6])\s*$/i.exec(city);
  return sector === null ? city.trim() : `SECTOR${sector[1]}`;
};

const normalAddress = (a: BuildAddress): BuildAddress => {
  const country = a.country.trim().toUpperCase();
  const county = country === "RO" ? countyCode(a.county) : a.county?.trim();
  return { ...a, country, county, city: county === "RO-B" ? bucharestCity(a.city) : a.city.trim(), street: a.street.trim() };
};

const normalParty = (p: BuildParty): BuildParty => ({
  ...p,
  vatId: p.vatId?.replace(/\s+/g, "").toUpperCase(),
  companyId: p.companyId?.trim(),
  address: normalAddress(p.address),
});

/** The draft as it will be written: codes in capitals, counties as ISO 3166-2, Bucharest's sector spelt as ANAF reads it. */
export const normalDraft = (d: InvoiceDraft): InvoiceDraft => ({
  ...d,
  number: d.number.trim(),
  currency: d.currency.trim().toUpperCase(),
  seller: normalParty(d.seller),
  buyer: normalParty(d.buyer),
  lines: d.lines.map((l) => ({ ...l, unitCode: l.unitCode.trim().toUpperCase() })),
  payment:
    d.payment === undefined
      ? undefined
      : {
          ...d.payment,
          iban: d.payment.iban?.replace(/\s+/g, "").toUpperCase(),
          meansCode: d.payment.meansCode ?? (d.payment.iban === undefined ? undefined : "30"),
        },
});

// --- what ANAF would refuse ----------------------------------------------------

const tooLong = (what: string, value: string | undefined, max: number): readonly string[] =>
  value !== undefined && [...value].length > max ? [`${what} is ${[...value].length} characters; CIUS-RO takes at most ${max}`] : [];

const addressProblems = (who: string, a: BuildAddress): readonly string[] => [
  ...tooLong(`${who}'s street`, a.street, MAX.street),
  ...tooLong(`${who}'s additional street`, a.additionalStreet, MAX.additionalStreet),
  ...tooLong(`${who}'s city`, a.city, MAX.city),
  ...tooLong(`${who}'s postal code`, a.postalCode, MAX.postalCode),
  ...(/^[A-Z]{2}$/.test(a.country) ? [] : [`${who}'s country must be a two-letter ISO code (RO, DE), got "${a.country}"`]),
  ...(a.country !== "RO"
    ? []
    : a.county === undefined
      ? [`${who}'s address is in Romania, so it needs its county (CJ, IS, B for Bucharest)`]
      : (RO_COUNTIES as readonly string[]).includes(a.county.slice(3))
        ? a.county === "RO-B" && !(BUCHAREST_SECTORS as readonly string[]).includes(a.city)
          ? [`${who}'s address is in Bucharest, so its city must be its sector, SECTOR1 to SECTOR6, got "${a.city}"`]
          : []
        : [`${who}'s county ${a.county} is not a Romanian county code (CJ, IS, B for Bucharest)`]),
];

/** A Romanian VAT id must pass its CIF's control digit; a foreign one is its country's business. */
const vatIdProblems = (who: string, vatId: string | undefined): readonly string[] => {
  if (vatId === undefined || !vatId.startsWith("RO")) return [];
  const checked = romanianCif(vatId);
  return checked.ok ? [] : [`${who}'s VAT id: ${checked.reason}`];
};

/** A Romanian buyer's legal id, when it is digits: a CIF by its control digit, a person's CNP by its own (13 zeros is ANAF's "not given"). */
const companyIdProblems = (who: string, p: BuildParty): readonly string[] => {
  const id = p.companyId;
  if (id === undefined || p.address.country !== "RO" || !/^\d+$/.test(id)) return [];
  if (/^\d{13}$/.test(id)) return id === "0000000000000" || cnp(id).ok ? [] : [`${who}'s CNP ${id} fails its control digit`];
  const checked = romanianCif(id);
  return checked.ok ? [] : [`${who}'s CUI: ${checked.reason}`];
};

const partyProblems = (who: string, p: BuildParty): readonly string[] => [
  ...tooLong(`${who}'s name`, p.name, MAX.partyName),
  ...tooLong(`${who}'s contact name`, p.contact?.name, MAX.contact),
  ...vatIdProblems(who, p.vatId),
  ...companyIdProblems(who, p),
  ...addressProblems(who, p.address),
];

const isDate = (v: string | undefined): boolean => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v);

const lineProblems = (line: BuildLine, index: number): readonly string[] => {
  const at = `line ${index + 1}`;
  const zeroRated = line.vatCategory !== "S";
  return [
    ...tooLong(`${at}'s name`, line.name, MAX.itemName),
    ...tooLong(`${at}'s description`, line.description, MAX.itemDescription),
    ...tooLong(`${at}'s note`, line.note, MAX.lineNote),
    ...(compare(toDecimal(line.price), ZERO) < 0 ? [`${at}: a price is never negative (BR-27); a line that reverses takes a negative quantity`] : []),
    ...(compare(toDecimal(line.quantity), ZERO) === 0 ? [`${at}: quantity 0`] : []),
    ...(/^[A-Z0-9]{2,3}$/.test(line.unitCode) ? [] : [`${at}: unit ${line.unitCode} is not a UN/ECE Recommendation 20 code (H87 piece, HUR hour, C62 one)`]),
    ...(zeroRated && compare(toDecimal(line.vatPercent), ZERO) !== 0
      ? [`${at}: VAT category ${line.vatCategory} has a rate of 0, not ${line.vatPercent}`]
      : !zeroRated && compare(toDecimal(line.vatPercent), ZERO) <= 0
        ? [`${at}: VAT category S needs a rate above 0 (21, 11); a line without VAT is Z, E, AE, G or O`]
        : []),
  ];
};

/** The categories the lines use, in the order they first appear. */
const categoriesOf = (lines: readonly BuildLine[]): readonly VatCategory[] => [...new Set(lines.map((l) => l.vatCategory))];

const vatProblems = (d: InvoiceDraft): readonly string[] => {
  const used = categoriesOf(d.lines);
  const exemptionFor = (c: VatCategory) => d.exemptions.find((e) => e.category === c);
  return [
    ...(used.includes("O") && used.length > 1 ? ["an invoice outside the scope of VAT (O) has no lines in another category (BR-O-11)"] : []),
    ...(used.includes("O") && (d.seller.vatId !== undefined || d.buyer.vatId !== undefined)
      ? ["an invoice outside the scope of VAT (O) names neither party's VAT id (BR-O-02)"]
      : []),
    ...(used.includes("O") && d.seller.companyId === undefined ? ["a seller without a VAT id needs its company_id (BR-CO-26)"] : []),
    ...(used.some((c) => c !== "O") && d.seller.vatId === undefined ? [`VAT category ${used.find((c) => c !== "O")} needs the seller's VAT id (BR-S-02 and its kin)`] : []),
    ...(used.includes("AE") && d.buyer.vatId === undefined && d.buyer.companyId === undefined
      ? ["reverse charge (AE) needs the buyer's VAT id or company_id (BR-AE-02)"]
      : []),
    ...(used.some((c) => c !== "O") && d.buyer.vatId === undefined && d.buyer.companyId === undefined
      ? ["the buyer needs a VAT id or a company_id (its CUI, or a person's CNP) (BR-RO-120)"]
      : []),
    ...NEEDS_EXEMPTION.filter((c) => used.includes(c) && DEFAULT_EXEMPTION[c] === undefined && exemptionFor(c)?.code === undefined && exemptionFor(c)?.reason === undefined).map(
      (c) => `VAT category ${c} needs an exemption reason: give vat_exemptions [{ category: "${c}", code (VATEX-EU-...) or reason }] (BR-${c}-10)`,
    ),
    ...d.exemptions.filter((e) => !used.includes(e.category)).map((e) => `vat_exemptions names category ${e.category}, which no line uses`),
  ];
};

const paymentProblems = (d: InvoiceDraft, total: DocumentTotal): readonly string[] => {
  const p = d.payment;
  const checked = p?.iban === undefined ? undefined : iban(p.iban);
  return [
    ...(checked === undefined || checked.ok ? [] : [`payment IBAN: ${checked.reason}`]),
    ...(p?.meansCode !== undefined && (CREDIT_TRANSFER as readonly string[]).includes(p.meansCode) && p.iban === undefined
      ? [`payment means ${p.meansCode} is a credit transfer, so it needs the iban to pay into (BR-61)`]
      : []),
    ...tooLong("the payment terms", p?.terms, MAX.terms),
    ...tooLong("the payment id", p?.paymentId, MAX.paymentId),
    ...(compare(toDecimal(total.gross), ZERO) > 0 && d.dueDate === undefined && p?.terms === undefined
      ? ["an amount is due, so the invoice needs a due_date or payment terms (BR-CO-25)"]
      : []),
  ];
};

/** Every reason the draft would be refused, all at once rather than one per round trip. Empty when it can be built. */
export const draftProblems = (d: InvoiceDraft): readonly string[] => {
  const lines = d.lines.flatMap(lineProblems);
  return [
    ...(d.number === "" || !/[0-9]/.test(d.number) ? ["the invoice number must contain at least one digit (BR-RO-010)"] : []),
    ...tooLong("the invoice number", d.number, MAX.number),
    ...(["issueDate", "dueDate", "deliveryDate"] as const).flatMap((k) => (isDate(d[k]) ? [] : [`${k} must be YYYY-MM-DD`])),
    ...(d.dueDate !== undefined && d.dueDate < d.issueDate ? [`the due date ${d.dueDate} is before the issue date ${d.issueDate}`] : []),
    ...(/^[A-Z]{3}$/.test(d.currency) ? [] : [`currency must be an ISO 4217 code (RON, EUR), got "${d.currency}"`]),
    ...(d.currency !== "RON" && d.vatExchangeRate === undefined
      ? [`an invoice in ${d.currency} states its VAT in RON too (BR-RO-030): give vat_exchange_rate, RON for one ${d.currency} (bnr's rate gives it)`]
      : []),
    ...(d.currency === "RON" && d.vatExchangeRate !== undefined ? ["vat_exchange_rate is for an invoice in another currency; this one is in RON"] : []),
    ...(d.notes.length > MAX.notes ? [`${d.notes.length} notes; CIUS-RO takes at most ${MAX.notes}`] : []),
    ...d.notes.flatMap((n, i) => tooLong(`note ${i + 1}`, n, MAX.note)),
    ...tooLong("buyer_reference", d.buyerReference, MAX.reference),
    ...tooLong("order_reference", d.orderReference, MAX.reference),
    ...tooLong("contract_reference", d.contractReference, MAX.reference),
    ...(d.lines.length === 0 ? ["an invoice has at least one line"] : []),
    ...(d.lines.length > MAX.lines ? [`${d.lines.length} lines; CIUS-RO takes at most ${MAX.lines}`] : []),
    ...partyProblems("the seller", d.seller),
    ...partyProblems("the buyer", d.buyer),
    ...(d.buyer.legalForm !== undefined ? ["legal_form is the seller's only (UBL-CR-244)"] : []),
    ...lines,
    ...(lines.length > 0 || d.lines.length === 0 ? [] : [...vatProblems(d), ...paymentProblems(d, invoiceTotals(d))]),
  ];
};

// --- totals --------------------------------------------------------------------

/** The kit's documentTotal over the lines (net prices, grouped by category and rate), and the VAT in RON at the given rate. */
export const invoiceTotals = (d: InvoiceDraft): BuiltTotals => {
  const total = documentTotal(
    d.lines.map((l) => ({ price: l.price, quantity: l.quantity, vatPercentage: l.vatPercent, vatCategory: l.vatCategory })),
    d.currency,
  );
  return d.vatExchangeRate === undefined
    ? total
    : { ...total, vatInRon: formatDecimal(round(mul(toDecimal(total.vat), toDecimal(d.vatExchangeRate)), AMOUNT_SCALE, "half-up")) };
};

// --- UBL -----------------------------------------------------------------------

const NS = {
  xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

const cbc = (name: string, value: string | undefined, attributes: Readonly<Record<string, string>> = {}) => el(`cbc:${name}`, value, attributes);
const cac = (name: string, children: readonly (XmlNode | undefined)[]) => el(`cac:${name}`, children);

const VAT_SCHEME = cac("TaxScheme", [cbc("ID", "VAT")]);

const address = (a: BuildAddress) =>
  cac("PostalAddress", [
    cbc("StreetName", a.street),
    cbc("AdditionalStreetName", a.additionalStreet),
    cbc("CityName", a.city),
    cbc("PostalZone", a.postalCode),
    cbc("CountrySubentity", a.county),
    cac("Country", [cbc("IdentificationCode", a.country)]),
  ]);

const party = (p: BuildParty, seller: boolean) =>
  cac("Party", [
    p.tradingName === undefined ? undefined : cac("PartyName", [cbc("Name", p.tradingName)]),
    address(p.address),
    p.vatId === undefined ? undefined : cac("PartyTaxScheme", [cbc("CompanyID", p.vatId), VAT_SCHEME]),
    cac("PartyLegalEntity", [cbc("RegistrationName", p.name), cbc("CompanyID", p.companyId), seller ? cbc("CompanyLegalForm", p.legalForm) : undefined]),
    p.contact === undefined
      ? undefined
      : cac("Contact", [cbc("Name", p.contact.name), cbc("Telephone", p.contact.phone), cbc("ElectronicMail", p.contact.email)]),
  ]);

/** A category's rate as UBL writes it: absent for O, which has none (BR-O-05). */
const percentOf = (category: string, percent: string): string | undefined => (category === "O" ? undefined : percent);

const exemption = (d: InvoiceDraft, category: VatCategory) => {
  const given = d.exemptions.find((e) => e.category === category);
  return NEEDS_EXEMPTION.includes(category) ? { code: given?.code ?? (given?.reason === undefined ? DEFAULT_EXEMPTION[category] : undefined), reason: given?.reason } : {};
};

const taxCategory = (d: InvoiceDraft, category: VatCategory, percent: string, element: "TaxCategory" | "ClassifiedTaxCategory") => {
  const why = element === "TaxCategory" ? exemption(d, category) : {};
  return cac(element, [
    cbc("ID", category),
    cbc("Percent", percentOf(category, percent)),
    cbc("TaxExemptionReasonCode", why.code),
    cbc("TaxExemptionReason", why.reason),
    VAT_SCHEME,
  ]);
};

/** The invoice as CIUS-RO UBL, and what it adds up to. Call `draftProblems` first: this writes whatever it is given. */
export const buildInvoiceXml = (draft: InvoiceDraft): { readonly xml: string; readonly totals: BuiltTotals } => {
  const d = draft;
  const totals = invoiceTotals(d);
  const money = (value: string, currency = d.currency) => ({ value, attributes: { currencyID: currency } });
  const amount = (name: string, m: { readonly value: string; readonly attributes: Readonly<Record<string, string>> }) => cbc(name, m.value, m.attributes);
  const p = d.payment;
  const root = el(
    "Invoice",
    [
      cbc("CustomizationID", CIUS_RO),
      cbc("ID", d.number),
      cbc("IssueDate", d.issueDate),
      cbc("DueDate", d.dueDate),
      cbc("InvoiceTypeCode", d.typeCode),
      ...d.notes.map((n) => cbc("Note", n)),
      cbc("DocumentCurrencyCode", d.currency),
      d.currency === "RON" ? undefined : cbc("TaxCurrencyCode", "RON"),
      cbc("BuyerReference", d.buyerReference),
      d.invoicePeriod === undefined ? undefined : cac("InvoicePeriod", [cbc("StartDate", d.invoicePeriod.start), cbc("EndDate", d.invoicePeriod.end)]),
      d.orderReference === undefined ? undefined : cac("OrderReference", [cbc("ID", d.orderReference)]),
      d.precedingInvoice === undefined
        ? undefined
        : cac("BillingReference", [cac("InvoiceDocumentReference", [cbc("ID", d.precedingInvoice.number), cbc("IssueDate", d.precedingInvoice.issueDate)])]),
      d.contractReference === undefined ? undefined : cac("ContractDocumentReference", [cbc("ID", d.contractReference)]),
      cac("AccountingSupplierParty", [party(d.seller, true)]),
      cac("AccountingCustomerParty", [party(d.buyer, false)]),
      d.deliveryDate === undefined ? undefined : cac("Delivery", [cbc("ActualDeliveryDate", d.deliveryDate)]),
      p?.meansCode === undefined
        ? undefined
        : cac("PaymentMeans", [
            cbc("PaymentMeansCode", p.meansCode),
            cbc("PaymentID", p.paymentId),
            p.iban === undefined
              ? undefined
              : cac("PayeeFinancialAccount", [
                  cbc("ID", p.iban),
                  cbc("Name", p.accountName),
                  p.bic === undefined ? undefined : cac("FinancialInstitutionBranch", [cbc("ID", p.bic)]),
                ]),
          ]),
      p?.terms === undefined ? undefined : cac("PaymentTerms", [cbc("Note", p.terms)]),
      cac("TaxTotal", [
        amount("TaxAmount", money(totals.vat)),
        ...totals.byRate.map((r) =>
          cac("TaxSubtotal", [
            amount("TaxableAmount", money(r.net)),
            amount("TaxAmount", money(r.vat)),
            taxCategory(d, r.vatCategory as VatCategory, r.vatPercentage, "TaxCategory"),
          ]),
        ),
      ]),
      totals.vatInRon === undefined ? undefined : cac("TaxTotal", [amount("TaxAmount", money(totals.vatInRon, "RON"))]),
      cac("LegalMonetaryTotal", [
        amount("LineExtensionAmount", money(totals.net)),
        amount("TaxExclusiveAmount", money(totals.net)),
        amount("TaxInclusiveAmount", money(totals.gross)),
        amount("PayableAmount", money(totals.gross)),
      ]),
      ...d.lines.map((l, i) =>
        cac("InvoiceLine", [
          cbc("ID", String(i + 1)),
          cbc("Note", l.note),
          cbc("InvoicedQuantity", l.quantity, { unitCode: l.unitCode }),
          amount("LineExtensionAmount", money(lineAmount({ price: l.price, quantity: l.quantity, vatPercentage: l.vatPercent }))),
          cac("Item", [
            cbc("Description", l.description),
            cbc("Name", l.name),
            l.sellerItemId === undefined ? undefined : cac("SellersItemIdentification", [cbc("ID", l.sellerItemId)]),
            taxCategory(d, l.vatCategory, l.vatPercent, "ClassifiedTaxCategory"),
          ]),
          cac("Price", [amount("PriceAmount", money(l.price))]),
        ]),
      ),
    ],
    NS,
  );
  if (root === undefined) throw new Error("an invoice always has content");
  return { xml: xmlDocument(root), totals };
};
