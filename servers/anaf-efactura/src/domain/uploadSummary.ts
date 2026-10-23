import type { InvoiceParty, InvoiceReading } from "./invoiceXml.js";
import type { UploadFlags } from "./upload.js";

/**
 * The ONE line a user confirms before an upload runs, when the server asks
 * (MCP_CONFIRM=elicit).
 *
 * Built from the XML itself, because the XML is what gets filed: the invoice
 * number and date, the buyer and the amount due first (what a person is most
 * likely to recognise, or to catch as wrong), then the seller, the syntax and
 * the flags. The environment leads, because a production upload is a legal
 * filing that cannot be withdrawn and a test upload has no effect at all.
 *
 * Anything the document does not say shows as `?` rather than being guessed,
 * and a document that cannot be read says so in capitals: the right answer to
 * a confirmation for an invoice nobody can describe is no.
 */
export type UploadIntent = {
  readonly test: boolean;
  readonly standard: string;
  /** The `cif` argument; empty means app.json's. */
  readonly cif: string;
  readonly flags: UploadFlags;
  /** Hex SHA-256 of the document's bytes; its first 12 characters end the line. */
  readonly sha256?: string | undefined;
  /** Filing again bytes already sent to production. */
  readonly refile?: boolean | undefined;
  /** An invoice to a person, through /uploadb2c. */
  readonly b2c?: boolean | undefined;
};

export const SUMMARY_MAX = 300;

const clean = (value: string | undefined, max: number): string => {
  const flat = (value ?? "?").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}~` : flat === "" ? "?" : flat;
};

const party = (p: InvoiceParty): string => `${clean(p.name, 40)} (${clean(p.cif, 20)})`;

const flagWords = (flags: UploadFlags): readonly string[] => [
  ...(flags.extern ? ["foreign buyer"] : []),
  ...(flags.autofactura ? ["self-billed"] : []),
  ...(flags.executare ? ["enforcement"] : []),
];

export const uploadSummary = (reading: InvoiceReading, intent: UploadIntent): string => {
  const where = intent.test
    ? "TEST upload to ANAF's test environment (no legal effect)"
    : "FILE with ANAF e-Factura PRODUCTION (legal filing, cannot be withdrawn)";
  const tail = [
    clean(intent.standard, 8),
    ...(intent.cif === "" ? [] : [`as CIF ${clean(intent.cif, 16)}`]),
    ...flagWords(intent.flags),
    ...(intent.refile === true ? ["AGAIN (refile)"] : []),
    ...(intent.sha256 === undefined ? [] : [`file sha256 ${intent.sha256.slice(0, 12)}`]),
  ].join(", ");
  const what =
    reading.kind === "unreadable"
      ? `${intent.b2c === true ? "B2C " : ""}UNREADABLE XML (${clean(reading.why, 90)}), nobody can say which invoice this is`
      : [
          `${intent.b2c === true ? "B2C " : ""}${reading.facts.document} ${clean(reading.facts.number, 30)} of ${clean(reading.facts.issueDate, 10)}`,
          `buyer ${party(reading.facts.buyer)}`,
          `payable ${clean(reading.facts.payable, 20)} ${clean(reading.facts.currency, 3)}`,
          `seller ${party(reading.facts.seller)}`,
        ].join(", ");
  return `${where}: ${what}; ${tail}`.slice(0, SUMMARY_MAX);
};
