/**
 * Just enough XML for ANAF's declarations, which keep every value in
 * attributes (the XSDs of D212, D100, D300 and D112 declare no text content):
 * each element's name and attributes, in document order. Comments, the XML
 * declaration and CDATA are skipped; a `>` inside a quoted value is read as
 * part of it. A DOCTYPE is refused: no declaration has one, and its entities
 * and defaults would make the validator read what this does not. The
 * validator judges the document; this reads what a person confirms. Pure.
 */
import { fail, inputError } from "../errors.js";

export type XmlElement = {
  /** The local name, without a namespace prefix. Attribute names are kept as written (`xmlns`, `xsi:schemaLocation`). */
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
};

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decoded = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (/^#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return NAMED[entity] ?? whole;
  });

const START_TAG = /<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * What is not an element: a processing instruction (the XML declaration is
 * one), a comment, a CDATA section. One pattern, so whichever opens first
 * wins, as in a parser: `<!-- <? -->` is a comment, and the `<?` in it opens
 * nothing that a later `?>` could close. Each becomes a space, so removing one
 * never joins its neighbours into markup.
 */
const NOT_ELEMENT = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

/** Every element's start tag, in order: the first is the root. */
export const elementsOf = (xml: string): readonly XmlElement[] => {
  const body = xml.replace(/^﻿/, "").replace(NOT_ELEMENT, " ");
  // Past comments and CDATA, a `<!` can only open a DOCTYPE (or is not XML).
  if (body.includes("<!")) fail(inputError("the XML has a DOCTYPE or an unclosed comment: no ANAF declaration has either, and a DOCTYPE's entities could make the validator read values other than the ones shown here"));
  return [...body.matchAll(START_TAG)].map((tag) => ({
    name: (tag[1] ?? "").replace(/^[\w.-]+:/, ""),
    attributes: Object.fromEntries([...(tag[2] ?? "").matchAll(ATTRIBUTE)].map((a) => [a[1] ?? "", decoded(a[2] ?? a[3] ?? "")])),
  }));
};
