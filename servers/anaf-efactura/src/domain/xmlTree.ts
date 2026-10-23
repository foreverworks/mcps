/**
 * The tree infra/xml.ts parses a document into, and the walks every reader of
 * one shares (invoiceXml.ts for the line a person confirms, invoiceView.ts for
 * parse_invoice, etransportXml.ts for a transport declaration).
 *
 * Local element names are the keys (namespace prefixes removed), attributes
 * sit under `@_<name>`, an element's text under `#text` when it also has
 * attributes, and a repeated element is an array. Every value is a string:
 * nothing here turns `0012` into twelve or `1234.50` into a float.
 */
export type XmlValue = string | XmlElement | readonly XmlValue[];
export type XmlElement = { readonly [name: string]: XmlValue };

export const isElement = (v: XmlValue | undefined): v is XmlElement => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first of a repeated element, or the element itself. */
export const one = (v: XmlValue | undefined): XmlValue | undefined => (Array.isArray(v) ? (v as readonly XmlValue[])[0] : v);

/** Every occurrence of a possibly repeated element. */
export const all = (v: XmlValue | undefined): readonly XmlValue[] =>
  v === undefined ? [] : Array.isArray(v) ? (v as readonly XmlValue[]) : [v as XmlValue];

/** The element at `path` under `node`, taking the first of any repeated step. */
export const at = (node: XmlValue | undefined, ...path: readonly string[]): XmlValue | undefined =>
  path.reduce<XmlValue | undefined>((here, name) => {
    const el = one(here);
    return isElement(el) ? el[name] : undefined;
  }, node);

const rawText = (v: XmlValue | undefined): string | undefined => {
  const el = one(v);
  return typeof el === "string" ? el : isElement(el) && typeof el["#text"] === "string" ? el["#text"] : undefined;
};

/** An element's text with its whitespace collapsed to single spaces; undefined when it has none. */
export const text = (v: XmlValue | undefined): string | undefined => {
  const trimmed = rawText(v)?.replace(/\s+/g, " ").trim();
  return trimmed === "" ? undefined : trimmed;
};

/** An element's text as written, line breaks kept, only trimmed at its ends: a note or a description. */
export const prose = (v: XmlValue | undefined): string | undefined => {
  const trimmed = rawText(v)?.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const attribute = (v: XmlValue | undefined, name: string): string | undefined => {
  const el = one(v);
  const value = isElement(el) ? el[`@_${name}`] : undefined;
  return typeof value === "string" ? value : undefined;
};

/** Every non-empty text at `path` under each of `nodes`. */
export const texts = (nodes: readonly XmlValue[], ...path: readonly string[]): readonly string[] =>
  nodes.map((node) => text(at(node, ...path))).filter((v): v is string => v !== undefined);
