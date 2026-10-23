/**
 * Just enough XML for ANAF's declarations, which keep every value in
 * attributes (the XSDs of D212, D100, D300 and D112 declare no text content):
 * each element's name and attributes, in document order. Comments, the XML
 * declaration and CDATA are skipped; a `>` inside a quoted value is read as
 * part of it. The validator judges the document; this reads what a person
 * confirms. Pure.
 */
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

/** Every element's start tag, in order: the first is the root. */
export const elementsOf = (xml: string): readonly XmlElement[] => {
  const body = xml
    .replace(/^﻿/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  return [...body.matchAll(START_TAG)].map((tag) => ({
    name: (tag[1] ?? "").replace(/^[\w.-]+:/, ""),
    attributes: Object.fromEntries([...(tag[2] ?? "").matchAll(ATTRIBUTE)].map((a) => [a[1] ?? "", decoded(a[2] ?? a[3] ?? "")])),
  }));
};
