import { cnp, romanianCif } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";

/**
 * A document is identified by a series and a number, both of which Oblio treats
 * as opaque strings. `number` is NOT an integer: series restart, and some are
 * zero-padded, so parsing it would lose information for no gain.
 */
export type DocumentRef = { readonly seriesName: string; readonly number: string };

export const parseRef = (seriesName: string, num: string): DocumentRef => {
  if (seriesName.trim() === "") fail(inputError("series_name is required; list_series shows the ones that exist"));
  if (num.trim() === "") fail(inputError("number is required"));
  return { seriesName: seriesName.trim(), number: num.trim() };
};

/**
 * Whether Oblio's answer names the document that was asked for. Series compare
 * without regard to case, numbers by value: Oblio may echo "0042" as 42.
 */
export const sameDocument = (asked: DocumentRef, answered: DocumentRef): boolean =>
  asked.seriesName.toUpperCase() === answered.seriesName.toUpperCase() &&
  asked.number.replace(/^0+(?=.)/, "") === answered.number.replace(/^0+(?=.)/, "");

/** Whether a country, as a person writes it, is Romania; absent means it is. */
const isRomania = (country: string | undefined): boolean =>
  country === undefined || /^(ro|romania|rom[aâ]nia)$/i.test(country.normalize("NFC").trim());

/**
 * Why the buyer's code cannot be what it claims, or undefined when it can be.
 * A Romanian buyer's code is a CIF (with RO for a VAT payer), checked by its
 * control digit, or a person's CNP, checked by its own; a transposed digit
 * otherwise issues the invoice to another company. A foreign buyer's code is
 * not this server's to check, and passes as written.
 */
export const clientCodeProblem = (code: string, country: string | undefined): string | undefined => {
  if (!isRomania(country)) return undefined;
  const compact = code.replace(/\s+/g, "").toUpperCase();
  if (/^[0-9]{13}$/.test(compact)) {
    const person = cnp(compact);
    return person.ok ? undefined : `client cif ${code}: ${person.reason}`;
  }
  const company = romanianCif(compact);
  return company.ok ? undefined : `client cif: ${company.reason} (a foreign buyer needs its country)`;
};

/** The product types Oblio accepts on a line, spelled as Oblio spells them. */
export const PRODUCT_TYPES = [
  "Marfa",
  "Materii prime",
  "Materiale consumabile",
  "Semifabricate",
  "Produs finit",
  "Produs rezidual",
  "Produse agricole",
  "Animale si pasari",
  "Ambalaje",
  "Obiecte de inventar",
  "Serviciu",
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** How an invoice was paid, when it is issued already collected. Oblio's own words. */
export const COLLECT_TYPES = [
  "Chitanta",
  "Bon fiscal",
  "Bon fiscal card",
  "Alta incasare numerar",
  "Ordin de plata",
  "Mandat postal",
  "Card",
  "CEC",
  "Bilet ordin",
  "Alta incasare banca",
  "Ramburs",
] as const;
export type CollectType = (typeof COLLECT_TYPES)[number];

/** The buyer, as it goes on the document. Only `name` is required by Oblio. */
export type Party = {
  readonly name: string;
  /** CIF for a company (with or without the RO prefix), CNP for a person. */
  readonly cif?: string;
  /** Trade register number, J99/123/2020. */
  readonly rc?: string;
  /** The client's code in Oblio's client list. */
  readonly code?: string;
  readonly address?: string;
  /** Judet. */
  readonly state?: string;
  readonly city?: string;
  readonly country?: string;
  readonly iban?: string;
  readonly bank?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly contact?: string;
  readonly vatPayer?: boolean;
  /** Update the saved client with these details. Oblio's default is not to. */
  readonly save?: boolean;
  /** Fill a Romanian company's details from its CIF. Oblio's default is not to. */
  readonly autocomplete?: boolean;
};

/**
 * One line of goods or services. Amounts are decimal strings in the
 * DOCUMENT's currency, never numbers.
 */
export type ProductLine = {
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  /** Per unit, in the document's currency. With or without VAT per `vatIncluded`. */
  readonly price: string;
  readonly quantity: string;
  readonly measuringUnit?: string;
  /** The rate's name in list_vat_rates, "Normala" and so on. */
  readonly vatName?: string;
  /** "21", "9", "0". Required: the total the user confirms is computed from it. */
  readonly vatPercentage: string;
  /** Required, because Oblio's default (included) silently turns a net price into a gross one. */
  readonly vatIncluded: boolean;
  readonly productType?: ProductType;
  /** The stock management (gestiune) the goods leave from, with stock enabled. */
  readonly management?: string;
  /** Save this price as the product's list price. Oblio's default is to. */
  readonly save?: boolean;
};

export type Collect = {
  readonly type: CollectType;
  /** The receipt series, required for "Chitanta". */
  readonly seriesName?: string;
  /** The payment's own document number, required for every type but "Chitanta". */
  readonly documentNumber?: string;
  /** Defaults, at Oblio, to the invoice total. */
  readonly value?: string;
  readonly issueDate?: string;
  readonly mentions?: string;
};

/** What a proforma and an invoice have in common. */
export type DocumentDraft = {
  readonly client: Party;
  readonly seriesName: string;
  /** YYYY-MM-DD; Oblio's default is today. */
  readonly issueDate?: string;
  readonly dueDate?: string;
  /** "RO" by default at Oblio; list the others in the Oblio web app. */
  readonly language?: string;
  /** Decimals kept on prices, 2 to 4. */
  readonly precision: number;
  readonly currency: string;
  /** For a document in a foreign currency; Oblio's default is the rate in the company settings. */
  readonly exchangeRate?: string;
  readonly products: readonly ProductLine[];
  readonly mentions?: string;
  /** Not shown to the client. */
  readonly internalNote?: string;
  readonly issuerName?: string;
  readonly workStation?: string;
  /** Oblio emails the document with the template under Settings, E-mail-uri alarma. */
  readonly sendEmail?: boolean;
  /** BT-13 on the e-Factura. */
  readonly orderNumber?: string;
  /** BT-12 on the e-Factura. */
  readonly contractNumber?: string;
  /** Oblio refuses a second document with the same key. */
  readonly idempotencyKey?: string;
};

export type ProformaDraft = DocumentDraft;

export type InvoiceDraft = DocumentDraft & {
  readonly deliveryDate?: string;
  readonly collectDate?: string;
  /** Issue it already paid. */
  readonly collect?: Collect;
  /** Take the goods out of stock, with stock enabled. */
  readonly useStock?: boolean;
};

export type FromProformaDraft = {
  readonly invoiceSeries: string;
  readonly proforma: DocumentRef;
  readonly idempotencyKey?: string;
};
