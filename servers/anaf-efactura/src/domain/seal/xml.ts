/**
 * A strict, small XML reader for ANAF's seal documents: a tree that keeps what
 * canonicalization needs (element and attribute names as written, namespace
 * declarations, text exactly as the parser must deliver it) and nothing else.
 *
 * Why not the invoice reader (infra/xml.ts, fast-xml-parser): that one strips
 * namespace prefixes and trims text, which is right for reading an invoice
 * and wrong for XML-DSig, where the signed bytes are the canonical form of
 * exactly what was written. A seal is a few kilobytes produced by a machine,
 * so a reader that refuses what it does not need (a DOCTYPE, an entity it
 * does not know) is both enough and safer.
 *
 * What it does, per XML 1.0: line endings normalised to LF before parsing
 * (§2.11); the five predefined entities and character references decoded;
 * attribute values normalised (§3.3.3: a literal tab, CR or LF becomes a
 * space, a character reference does not); CDATA delivered as text.
 */

export type XmlAttribute = { readonly name: string; readonly value: string };

export type XmlNode =
  | { readonly kind: "element"; readonly name: string; readonly attributes: readonly XmlAttribute[]; readonly children: readonly XmlNode[] }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "comment" }
  | { readonly kind: "pi"; readonly target: string; readonly data: string };

export type XmlElement = Extract<XmlNode, { kind: "element" }>;

export type XmlRead = { readonly ok: true; readonly root: XmlElement } | { readonly ok: false; readonly why: string };

const NAME = /^[A-Za-z_][\w.:-]*/;
const PREDEFINED: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Thrown inside the reader and caught at its edge: a tagged object, like every failure in this repo. */
type Refusal = { readonly refused: string };

const refuse = (why: string): never => {
  throw { refused: why } satisfies Refusal;
};

const isRefusal = (thrown: unknown): thrown is Refusal =>
  typeof thrown === "object" && thrown !== null && typeof (thrown as { refused?: unknown }).refused === "string";

/** `&...;` references decoded; anything else after `&` is not well-formed. */
const decode = (raw: string): string =>
  raw.replace(/&([^;&\s]*);?/g, (whole, ref: string) => {
    if (!whole.endsWith(";")) return refuse(`a bare "&" near "${whole}"`);
    const predefined = PREDEFINED[ref];
    if (predefined !== undefined) return predefined;
    const code = /^#x([0-9A-Fa-f]+)$/.exec(ref)?.[1] ?? /^#([0-9]+)$/.exec(ref)?.[1];
    if (code === undefined) return refuse(`the entity &${ref}; is not one XML predefines`);
    const point = ref.startsWith("#x") ? Number.parseInt(code, 16) : Number.parseInt(code, 10);
    if (!Number.isFinite(point) || point > 0x10ffff) return refuse(`&${ref}; is not a character`);
    return String.fromCodePoint(point);
  });

/** Attribute value normalisation for CDATA attributes: literal whitespace becomes a space before references are decoded. */
const attributeValue = (raw: string): string => decode(raw.replace(/[\t\n\r]/g, " "));

export const readXml = (input: string): XmlRead => {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (/<!DOCTYPE/i.test(text)) return { ok: false, why: "the document declares a DOCTYPE" };
  let at = 0;
  const stack: { name: string; attributes: XmlAttribute[]; children: XmlNode[] }[] = [];
  let root: XmlElement | undefined;

  const append = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(node);
    else if (node.kind === "element") {
      if (root !== undefined) refuse("more than one root element");
      root = node;
    } else if (node.kind === "text" && node.text.trim() !== "") refuse("text outside the root element");
  };

  try {
    while (at < text.length) {
      const lt = text.indexOf("<", at);
      if (lt < 0) {
        append({ kind: "text", text: decode(text.slice(at)) });
        break;
      }
      if (lt > at) append({ kind: "text", text: decode(text.slice(at, lt)) });
      if (text.startsWith("<!--", lt)) {
        const end = text.indexOf("-->", lt + 4);
        if (end < 0) refuse("an unterminated comment");
        append({ kind: "comment" });
        at = end + 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        const end = text.indexOf("]]>", lt + 9);
        if (end < 0 || stack.length === 0) refuse("a CDATA section outside an element, or unterminated");
        append({ kind: "text", text: text.slice(lt + 9, end) });
        at = end + 3;
      } else if (text.startsWith("<?", lt)) {
        const end = text.indexOf("?>", lt + 2);
        if (end < 0) refuse("an unterminated processing instruction");
        const body = text.slice(lt + 2, end);
        const target = NAME.exec(body)?.[0] ?? refuse("a processing instruction without a target");
        // The XML declaration is not a processing instruction and is not part of the infoset.
        if (target.toLowerCase() !== "xml") append({ kind: "pi", target, data: body.slice(target.length).replace(/^\s+/, "") });
        at = end + 2;
      } else if (text.startsWith("</", lt)) {
        const end = text.indexOf(">", lt);
        const name = text.slice(lt + 2, end).trim();
        const top = stack.pop();
        const open = end >= 0 && top !== undefined && top.name === name ? top : refuse(`</${name}> does not close the open element`);
        append({ kind: "element", name, attributes: open.attributes, children: open.children });
        at = end + 1;
      } else {
        const name = NAME.exec(text.slice(lt + 1))?.[0] ?? refuse("a start tag without a name");
        let i = lt + 1 + name.length;
        const attributes: XmlAttribute[] = [];
        for (;;) {
          const rest = /^\s*/.exec(text.slice(i))?.[0] ?? "";
          i += rest.length;
          if (text.startsWith("/>", i)) {
            append({ kind: "element", name, attributes, children: [] });
            i += 2;
            break;
          }
          if (text.startsWith(">", i)) {
            stack.push({ name, attributes, children: [] });
            i += 1;
            break;
          }
          if (rest === "") refuse(`<${name}> has no space before an attribute`);
          const attribute = /^([A-Za-z_][\w.:-]*)\s*=\s*("([^"<]*)"|'([^'<]*)')/.exec(text.slice(i));
          if (!attribute) refuse(`<${name}> has an attribute that is not name="value"`);
          const [whole = "", attributeName = "", , double, single] = attribute ?? [];
          if (attributes.some((a) => a.name === attributeName)) refuse(`<${name}> repeats ${attributeName}`);
          attributes.push({ name: attributeName, value: attributeValue(double ?? single ?? "") });
          i += whole.length;
        }
        at = i;
      }
    }
    if (stack.length > 0) refuse(`<${stack[stack.length - 1]?.name}> is never closed`);
    return root === undefined ? { ok: false, why: "no root element" } : { ok: true, root };
  } catch (thrown) {
    if (isRefusal(thrown)) return { ok: false, why: thrown.refused };
    throw thrown;
  }
};

/** An element's prefix and local name. */
export const splitName = (name: string): { readonly prefix: string; readonly local: string } => {
  const colon = name.indexOf(":");
  return colon < 0 ? { prefix: "", local: name } : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
};

/** The namespace bindings an element declares itself: prefix ("" for the default) to URI. */
export const declaredNamespaces = (element: XmlElement): ReadonlyMap<string, string> =>
  new Map(
    element.attributes.flatMap((a) =>
      a.name === "xmlns" ? [["", a.value] as const] : a.name.startsWith("xmlns:") ? [[a.name.slice(6), a.value] as const] : [],
    ),
  );

/** The bindings in scope on an element, given those in scope on its parent. */
export const inScope = (parent: ReadonlyMap<string, string>, element: XmlElement): ReadonlyMap<string, string> => {
  const own = declaredNamespaces(element);
  return own.size === 0 ? parent : new Map([...parent, ...own]);
};

/** The namespace URI of a name, given the bindings in scope; "" for none. */
export const namespaceOf = (name: string, scope: ReadonlyMap<string, string>, isAttribute: boolean): string => {
  const { prefix } = splitName(name);
  if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
  if (prefix === "") return isAttribute ? "" : (scope.get("") ?? "");
  return scope.get(prefix) ?? "";
};
