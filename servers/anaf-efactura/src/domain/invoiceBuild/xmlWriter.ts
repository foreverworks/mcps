/**
 * The few lines of XML writing a built invoice needs: elements in the order
 * they are given, text and attributes escaped, two spaces of indentation.
 * Pure, so the same draft always gives the same bytes, which is what lets a
 * test hold a built file to the validator answer recorded for its SHA-256.
 *
 * An element whose content is absent is not written at all: a field the draft
 * does not fill does not appear as an empty element (which UBL would refuse).
 */
export type XmlNode = { readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly content: string | readonly XmlNode[] };

/** An element, or nothing when its text is undefined or every child is. */
export const el = (
  name: string,
  content: string | undefined | readonly (XmlNode | undefined)[],
  attributes: Readonly<Record<string, string>> = {},
): XmlNode | undefined => {
  if (content === undefined) return undefined;
  if (typeof content === "string") return { name, attributes, content };
  const children = content.filter((c): c is XmlNode => c !== undefined);
  return children.length === 0 ? undefined : { name, attributes, content: children };
};

const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, "&quot;");

const write = (node: XmlNode, depth: number): string => {
  const pad = "  ".repeat(depth);
  const attributes = Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join("");
  if (typeof node.content === "string") return `${pad}<${node.name}${attributes}>${escapeText(node.content)}</${node.name}>\n`;
  return `${pad}<${node.name}${attributes}>\n${node.content.map((child) => write(child, depth + 1)).join("")}${pad}</${node.name}>\n`;
};

/** A whole document: the declaration, then the root. */
export const xmlDocument = (root: XmlNode): string => `<?xml version="1.0" encoding="UTF-8"?>\n${write(root, 0)}`;
