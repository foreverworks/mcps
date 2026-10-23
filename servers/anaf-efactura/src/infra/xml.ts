import { XMLParser } from "fast-xml-parser";

import { type DeclarationReading, readDeclaration } from "../domain/etransportFiling.js";
import { type InvoiceReading, readInvoice } from "../domain/invoiceXml.js";
import { type InvoiceViewReading, viewInvoice } from "../domain/invoiceView.js";
import type { XmlElement } from "../domain/xmlTree.js";

/**
 * XML into the tree shape domain/invoiceXml.ts walks, with fast-xml-parser.
 *
 * - Namespace prefixes are removed: UBL writes `cbc:ID` and CII `ram:ID`, and
 *   a document is free to pick other prefixes for the same namespaces, so the
 *   local name is the only stable key.
 * - Values stay strings (`parseTagValue`/`parseAttributeValue` off): `0012`
 *   is an invoice number, not twelve, and `1234.50` is an amount that must
 *   never pass through a float.
 * - A DOCTYPE is refused before parsing. Neither syntax uses one, ANAF's
 *   answers never carry one, and it is the only door to entity expansion.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  trimValues: true,
});

export type XmlParse = { readonly ok: true; readonly tree: XmlElement } | { readonly ok: false; readonly why: string };

export const parseXml = (text: string): XmlParse => {
  if (/<!DOCTYPE/i.test(text)) return { ok: false, why: "the document declares a DOCTYPE" };
  try {
    const tree: unknown = parser.parse(text, true);
    return typeof tree === "object" && tree !== null
      ? { ok: true, tree: tree as XmlElement }
      : { ok: false, why: "the document has no elements" };
  } catch (cause) {
    return { ok: false, why: `not well-formed XML: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

/**
 * What an invoice document says about itself. The ONE reading of an invoice
 * XML: the summary a user confirms (mcp/policy.ts) and the result of
 * the upload (app/usecases/uploads.ts, through Deps) both come from here, so
 * what a user confirmed and what the tool reports as filed cannot disagree.
 */
export const readInvoiceXml = (xml: string): InvoiceReading => {
  const parsed = parseXml(xml);
  return parsed.ok ? readInvoice(parsed.tree) : { kind: "unreadable", why: parsed.why };
};

/** A UBL invoice or credit note as plain JSON (domain/invoiceView.ts), for parse_invoice. */
export const viewInvoiceXml = (xml: string): InvoiceViewReading => {
  const parsed = parseXml(xml);
  return parsed.ok ? viewInvoice(parsed.tree) : { kind: "unreadable", why: parsed.why };
};

/** The namespace of ANAF's e-Transport schema v2, the one etransport_file files (`/upload/ETRANSP/{cif}/2`). */
export const ETRANSPORT_V2 = "mfp:anaf:dgti:eTransport:declaratie:v2";

/**
 * What an e-Transport declaration does (domain/etransportFiling.ts): the ONE
 * reading the line a person confirms and the filing's result both come from.
 * The parser drops namespace declarations, so the schema's is looked for in
 * the text: a v1 declaration, or anything else, is refused before it is sent.
 */
export const readDeclarationXml = (xml: string): DeclarationReading => {
  const parsed = parseXml(xml);
  if (!parsed.ok) return { kind: "unreadable", why: parsed.why };
  if (!xml.includes(`"${ETRANSPORT_V2}"`) && !xml.includes(`'${ETRANSPORT_V2}'`))
    return { kind: "unreadable", why: `the declaration does not declare ANAF's schema v2 (${ETRANSPORT_V2}), the one this server files` };
  return readDeclaration(parsed.tree);
};
