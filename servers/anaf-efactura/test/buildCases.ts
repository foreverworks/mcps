/**
 * Invoices build_invoice is held to: each one built here, sent once to ANAF's
 * public validator by scripts/record-validation.ts, and its answer recorded in
 * test/fixtures/validation/<case>.json with the SHA-256 of the bytes it judged.
 * test/build.test.ts builds each again and requires the same bytes and a
 * recorded "ok", so a builder that writes anything else fails until it is
 * recorded again.
 *
 * Every party, id and amount is invented. The CIFs have a valid control digit
 * and sit far above the range ANAF assigns, and its public registry
 * (lookup_company) knew none of them when they were chosen. The CNP and the
 * trade register numbers use county 99, which does not exist. The IBAN is the
 * standard example, and the addresses are example streets.
 */

const seller = {
  name: "Exemplu Software SRL",
  vat_id: "RO92345672",
  company_id: "J99/1234/2020",
  legal_form: "Capital social 200 RON",
  address: { street: "Strada Exemplului 1", city: "Sector 1", postal_code: "010101", county: "B", country: "RO" },
  contact: { name: "Ana Popescu", phone: "0700000000", email: "ana@example.com" },
};

const romanianBuyer = {
  name: "Client Exemplu SRL",
  vat_id: "RO87654329",
  company_id: "J99/345/2019",
  address: { street: "Strada Clientului 2", city: "Cluj-Napoca", postal_code: "400001", county: "CJ" },
};

const pay = { iban: "RO49AAAA1B31007593840000", account_name: "Exemplu Software SRL" };

export const BUILD_CASES = {
  /** RON, two rates, a line whose amount rounds, an IBAN and a due date. */
  "ron-standard": {
    number: "EXS-2026-0101",
    issue_date: "2026-10-01",
    due_date: "2026-10-31",
    notes: ["Thank you for your business."],
    order_reference: "PO-7781",
    seller,
    buyer: romanianBuyer,
    payment: { ...pay, payment_id: "EXS-2026-0101" },
    lines: [
      { name: "Software development", quantity: "16", unit_code: "HUR", price: "150.00", vat_percent: "21" },
      { name: "Hosting", description: "October", quantity: "1", unit_code: "MON", price: "99.99", vat_percent: "21" },
      { name: "Printed manual", quantity: "3", price: "0.333", vat_percent: "11" },
    ],
  },
  /** EUR to an EU business, reverse charge (AE), its VAT also stated in RON, payment terms instead of a due date. */
  "eur-reverse-charge": {
    number: "EXS-2026-0102",
    issue_date: "2026-10-02",
    currency: "EUR",
    vat_exchange_rate: "4.9763",
    invoice_period: { start: "2026-09-01", end: "2026-09-30" },
    seller,
    buyer: {
      name: "Beispiel GmbH",
      vat_id: "DE123456749",
      address: { street: "Musterstrasse 5", city: "Berlin", postal_code: "10115", country: "DE" },
    },
    payment: { ...pay, terms: "Payment within 30 days of the invoice date." },
    lines: [{ name: "Consulting services", quantity: "12.5", unit_code: "HUR", price: "80.00", vat_category: "AE" }],
  },
  /** An exempt supply (E), with the law's words for why, to a buyer who is not a VAT payer (its CUI alone). */
  "exempt-non-vat-buyer": {
    number: "EXS-2026-0103",
    issue_date: "2026-10-03",
    due_date: "2026-10-17",
    seller,
    buyer: {
      name: "Asociatia Exemplu",
      company_id: "91122338",
      address: { street: "Strada Asociatiei 3", city: "Iasi", county: "IS" },
    },
    payment: pay,
    lines: [{ name: "Training course", quantity: "2", unit_code: "C62", price: "450.00", vat_category: "E" }],
    vat_exemptions: [{ category: "E", reason: "Scutit de TVA conform art. 292 alin. (2) lit. a) din Codul fiscal" }],
  },
  /** To a person (B2C), who is identified by a CNP; paid in cash on the day. */
  "b2c-person": {
    number: "EXS-2026-0104",
    issue_date: "2026-10-04",
    due_date: "2026-10-04",
    seller,
    buyer: {
      name: "Ion Popescu",
      // Invented: county 99 does not exist. ANAF's validator refuses a CNP whose
      // date cannot exist (month 00), so the county is what makes it no one's.
      company_id: "1850101990007",
      address: { street: "Strada Florilor 4", city: "Brasov", county: "BV" },
    },
    payment: { means_code: "10" },
    lines: [{ name: "Software license", quantity: "1", price: "249.00", vat_percent: "21" }],
  },
  /** A storno of ron-standard's first line: a negative quantity, and the invoice it reverses. */
  storno: {
    number: "EXS-2026-0105",
    issue_date: "2026-10-05",
    preceding_invoice: { number: "EXS-2026-0101", issue_date: "2026-10-01" },
    notes: ["Stornare partiala a facturii EXS-2026-0101."],
    seller,
    buyer: romanianBuyer,
    lines: [{ name: "Software development", quantity: "-16", unit_code: "HUR", price: "150.00", vat_percent: "21" }],
  },
  /** An export outside the EU (G), in USD, to a buyer identified by its own registration number. */
  "usd-export": {
    number: "EXS-2026-0106",
    issue_date: "2026-10-06",
    due_date: "2026-11-05",
    currency: "USD",
    vat_exchange_rate: "4.3712",
    seller,
    buyer: {
      name: "Example Corp",
      company_id: "12-3456789",
      address: { street: "1 Example Avenue", city: "Springfield", postal_code: "62701", country: "US" },
    },
    delivery_date: "2026-10-06",
    payment: pay,
    lines: [{ name: "Hardware appliance", quantity: "4", unit_code: "H87", price: "1250.00", vat_category: "G" }],
  },
  /** A seller outside the scope of VAT (O): no VAT ids on either side. */
  "outside-scope": {
    number: "EXO-2026-0001",
    issue_date: "2026-10-07",
    due_date: "2026-10-21",
    seller: {
      name: "Exemplu Mic SRL",
      company_id: "95566775",
      address: { street: "Strada Mica 7", city: "Timisoara", county: "TM" },
    },
    buyer: { name: "Client Exemplu SRL", company_id: "87654329", address: { street: "Strada Clientului 2", city: "Cluj-Napoca", county: "CJ" } },
    payment: { iban: pay.iban },
    lines: [{ name: "Translation services", quantity: "10", unit_code: "C62", price: "35.00", vat_category: "O" }],
  },
} as const;

export type BuildCase = keyof typeof BUILD_CASES;

/**
 * ANAF's validator has no `extern` flag, so it holds every buyer to a
 * Romanian CUI and answers a foreign buyer with one finding, ERRIdentif "nu a
 * fost identificat cui cumparator", which an upload with extern: true does not
 * raise. These cases are the ones with a foreign buyer; their "identified"
 * variant is the same invoice with an invented Romanian CUI added as the
 * buyer's legal id, recorded once to show nothing else in the file is refused.
 */
export const FOREIGN_BUYER_CASES = ["eur-reverse-charge", "usd-export"] as const satisfies readonly BuildCase[];

export const identifiedVariant = (name: (typeof FOREIGN_BUYER_CASES)[number]) => {
  const base = BUILD_CASES[name];
  return { ...base, buyer: { ...base.buyer, company_id: "93141590" } };
};
