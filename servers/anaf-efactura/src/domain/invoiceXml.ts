import { iban, romanianCif } from "@foreverworks/mcp-kit";

import { all, at, attribute, text, texts, type XmlElement, type XmlValue } from "./xmlTree.js";

/**
 * What an invoice XML says about itself: which document, whose, for how much.
 *
 * Read from a tree, not from text: infra/xml.ts parses the document with a
 * real XML parser and hands this module the result, so everything here is a
 * pure walk over data (xmlTree.ts). Element names are the local names of UBL 2.1
 * (Invoice, CreditNote) and UN/CEFACT CII (CrossIndustryInvoice), the two
 * syntaxes ANAF's /upload takes, with their namespace prefixes removed.
 *
 * Amounts stay the decimal strings the document carries. Nothing here adds,
 * rounds or converts one, so no float ever touches a total.
 */

export type InvoiceParty = { readonly name: string | undefined; readonly cif: string | undefined };

export type InvoiceFacts = {
  readonly syntax: "UBL" | "CII";
  readonly document: "invoice" | "credit note";
  readonly number: string | undefined;
  readonly issueDate: string | undefined;
  readonly seller: InvoiceParty;
  readonly buyer: InvoiceParty;
  /** The amount due, exactly as written, and its currency. */
  readonly payable: string | undefined;
  readonly currency: string | undefined;
  /**
   * The bank accounts the document names for payment, as written: the payee's
   * (BT-84) and, for a direct debit, the payer's (BT-91). Empty when it names none.
   */
  readonly accounts: readonly string[];
};

export type InvoiceReading =
  | { readonly kind: "invoice"; readonly facts: InvoiceFacts }
  | { readonly kind: "unreadable"; readonly why: string };

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

/** A decimal string, or undefined for anything that is not one. Never a number. */
const decimal = (v: string | undefined): string | undefined => (v !== undefined && DECIMAL.test(v) ? v : undefined);

/** CII writes dates as format 102, `YYYYMMDD`. */
const ciiDate = (v: string | undefined): string | undefined =>
  v !== undefined && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;

/**
 * A UBL party. The CIF is the tax scheme's CompanyID (BT-31/BT-48, `RO...` for
 * a VAT payer), else the legal entity's CompanyID, which is where CIUS-RO puts
 * the CUI of a party that is not VAT-registered.
 */
const ublParty = (party: XmlValue | undefined): InvoiceParty => ({
  name: text(at(party, "PartyLegalEntity", "RegistrationName")) ?? text(at(party, "PartyName", "Name")),
  cif:
    all(at(party, "PartyTaxScheme"))
      .map((scheme) => text(at(scheme, "CompanyID")))
      .find((id) => id !== undefined) ?? text(at(party, "PartyLegalEntity", "CompanyID")),
});

const readUbl = (root: XmlValue, document: InvoiceFacts["document"]): InvoiceFacts => {
  const payable = at(root, "LegalMonetaryTotal", "PayableAmount");
  const means = all(at(root, "PaymentMeans"));
  return {
    syntax: "UBL",
    document,
    number: text(at(root, "ID")),
    issueDate: text(at(root, "IssueDate")),
    seller: ublParty(at(root, "AccountingSupplierParty", "Party")),
    buyer: ublParty(at(root, "AccountingCustomerParty", "Party")),
    payable: decimal(text(payable)),
    currency: attribute(payable, "currencyID") ?? text(at(root, "DocumentCurrencyCode")),
    accounts: [...texts(means, "PayeeFinancialAccount", "ID"), ...texts(means, "PaymentMandate", "PayerFinancialAccount", "ID")],
  };
};

/** A CII trade party: its VAT registration (schemeID VA) first, then any tax registration, then the legal one. */
const ciiParty = (party: XmlValue | undefined): InvoiceParty => {
  const registrations = all(at(party, "SpecifiedTaxRegistration")).map((r) => at(r, "ID"));
  const vat = registrations.find((id) => attribute(id, "schemeID") === "VA");
  return {
    name: text(at(party, "Name")),
    cif: text(vat) ?? registrations.map(text).find((id) => id !== undefined) ?? text(at(party, "SpecifiedLegalOrganization", "ID")),
  };
};

const readCii = (root: XmlValue): InvoiceFacts => {
  const agreement = at(root, "SupplyChainTradeTransaction", "ApplicableHeaderTradeAgreement");
  const settlement = at(root, "SupplyChainTradeTransaction", "ApplicableHeaderTradeSettlement");
  const due = at(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation", "DuePayableAmount");
  const means = all(at(settlement, "SpecifiedTradeSettlementPaymentMeans"));
  return {
    syntax: "CII",
    // 381 is the credit note type code (UNTDID 1001); CII has one root for both.
    document: text(at(root, "ExchangedDocument", "TypeCode")) === "381" ? "credit note" : "invoice",
    number: text(at(root, "ExchangedDocument", "ID")),
    issueDate: ciiDate(text(at(root, "ExchangedDocument", "IssueDateTime", "DateTimeString"))),
    seller: ciiParty(at(agreement, "SellerTradeParty")),
    buyer: ciiParty(at(agreement, "BuyerTradeParty")),
    payable: decimal(text(due)),
    currency: attribute(due, "currencyID") ?? text(at(settlement, "InvoiceCurrencyCode")),
    accounts: [
      ...texts(means, "PayeePartyCreditorFinancialAccount", "IBANID"),
      ...texts(means, "PayerPartyDebtorFinancialAccount", "IBANID"),
    ],
  };
};

/**
 * Why an account the document names cannot be the one meant: anything shaped
 * like an IBAN (two letters, two digits) must pass its own check digits, so a
 * transposed digit fails before the invoice is filed and a client pays the
 * wrong account. An account in another scheme is left as written.
 */
export const accountProblems = (facts: InvoiceFacts): readonly string[] =>
  facts.accounts.flatMap((account) => {
    if (!/^[A-Za-z]{2}[0-9]{2}/.test(account.replace(/\s+/g, ""))) return [];
    const checked = iban(account);
    return checked.ok ? [] : [checked.reason];
  });

/**
 * The seller's tax code, where it is a Romanian one, must pass its control
 * digit: a transposed digit files the invoice for another company. A code that
 * is not a Romanian fiscal code (a foreign seller's VAT id) is left to ANAF.
 */
export const sellerProblems = (facts: InvoiceFacts): readonly string[] => {
  const cif = facts.seller.cif;
  if (cif === undefined) return [];
  const compact = cif.replace(/[\s.-]/g, "").toUpperCase();
  if (!/^(RO)?[0-9]+$/.test(compact)) return [];
  const checked = romanianCif(compact);
  return checked.ok ? [] : [`the seller's CIF ${cif} ${checked.reason.replace(/^"[^"]*" /, "")}`];
};

export const readInvoice = (tree: XmlElement): InvoiceReading => {
  if (tree["Invoice"] !== undefined) return { kind: "invoice", facts: readUbl(tree["Invoice"], "invoice") };
  if (tree["CreditNote"] !== undefined) return { kind: "invoice", facts: readUbl(tree["CreditNote"], "credit note") };
  if (tree["CrossIndustryInvoice"] !== undefined) return { kind: "invoice", facts: readCii(tree["CrossIndustryInvoice"]) };
  const roots = Object.keys(tree).filter((k) => !k.startsWith("?") && !k.startsWith("@_"));
  return { kind: "unreadable", why: `root element ${roots[0] ?? "(none)"} is not Invoice, CreditNote or CrossIndustryInvoice` };
};
