import { inScope, namespaceOf, splitName, type XmlAttribute, type XmlElement, type XmlNode } from "./xml.js";

/**
 * Canonical XML of one element and everything under it: the bytes an XML
 * signature over `SignedInfo` is computed on.
 *
 * Two algorithms, without comments, as XML-DSig names them:
 * - `inclusive`: Canonical XML 1.0 (https://www.w3.org/TR/2001/REC-xml-c14n-20010315).
 *   The apex carries every namespace in scope, and every `xml:*` attribute
 *   it inherits; a descendant repeats a declaration only when it differs
 *   from its parent's.
 * - `exclusive`: Exclusive XML Canonicalization 1.0 (https://www.w3.org/TR/xml-exc-c14n/),
 *   with an empty InclusiveNamespaces list: a namespace is declared where it
 *   is visibly used and not already declared above in the output.
 *
 * ANAF declares the inclusive one, and its seals confirm that is what it
 * signs. The output is the same as the exclusive form for them. lxml's C14N of a SignedInfo cut out of its
 * document adds `xmlns=""` to DigestMethod, which is why an earlier reading
 * concluded ANAF signed the exclusive form; it does not.
 */
export type C14nMode = "inclusive" | "exclusive";

export const C14N_ALGORITHMS: Readonly<Record<string, C14nMode>> = {
  "http://www.w3.org/TR/2001/REC-xml-c14n-20010315": "inclusive",
  "http://www.w3.org/2001/10/xml-exc-c14n#": "exclusive",
};

export type C14nResult = { readonly ok: true; readonly bytes: string } | { readonly ok: false; readonly why: string };

const escapeText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");

const isDeclaration = (a: XmlAttribute): boolean => a.name === "xmlns" || a.name.startsWith("xmlns:");

type Rendering = { readonly out: string[]; readonly mode: C14nMode };

/** Namespace declarations sort by prefix, the default ("") first; attributes by namespace URI, then local name. */
const byPrefix = (a: readonly [string, string], b: readonly [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

const renderElement = (
  r: Rendering,
  element: XmlElement,
  scope: ReadonlyMap<string, string>,
  parentOutput: ReadonlyMap<string, string>,
  inherited: readonly XmlAttribute[],
): void => {
  const attributes = [...element.attributes.filter((a) => !isDeclaration(a)), ...inherited];
  for (const name of [element.name, ...attributes.map((a) => a.name)]) {
    const { prefix } = splitName(name);
    if (prefix !== "" && prefix !== "xml" && !scope.has(prefix)) throw { unbound: prefix };
  }

  // Which namespace declarations this element renders, and what is then in effect for its children.
  const wanted: readonly (readonly [string, string])[] =
    r.mode === "inclusive"
      ? [...scope].filter(([prefix]) => prefix !== "xml")
      : [
          ...new Set([splitName(element.name).prefix, ...attributes.map((a) => splitName(a.name).prefix).filter((p) => p !== "")]),
        ]
          .filter((prefix) => prefix !== "xml")
          .map((prefix) => [prefix, scope.get(prefix) ?? ""] as const);
  const rendered = wanted.filter(([prefix, uri]) =>
    prefix === "" ? (parentOutput.get("") ?? "") !== uri : parentOutput.get(prefix) !== uri,
  );
  // Inclusive: a default namespace that is empty here but not on the parent is undeclared (xmlns="").
  const undeclare =
    r.mode === "inclusive" && (scope.get("") ?? "") === "" && (parentOutput.get("") ?? "") !== "" && !rendered.some(([p]) => p === "");
  const declarations = [...rendered, ...(undeclare ? [["", ""] as const] : [])].sort(byPrefix);
  const output = r.mode === "inclusive" ? new Map([...scope, ...(undeclare ? [["", ""] as const] : [])]) : new Map([...parentOutput, ...declarations]);

  const sorted = attributes
    .map((a) => ({ a, ns: namespaceOf(a.name, scope, true), local: splitName(a.name).local }))
    .sort((x, y) => (x.ns !== y.ns ? (x.ns < y.ns ? -1 : 1) : x.local < y.local ? -1 : x.local > y.local ? 1 : 0));

  r.out.push(`<${element.name}`);
  for (const [prefix, uri] of declarations) r.out.push(prefix === "" ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`);
  for (const { a } of sorted) r.out.push(` ${a.name}="${escapeAttribute(a.value)}"`);
  r.out.push(">");
  for (const child of element.children) renderNode(r, child, scope, output);
  r.out.push(`</${element.name}>`);
};

const renderNode = (r: Rendering, node: XmlNode, parentScope: ReadonlyMap<string, string>, parentOutput: ReadonlyMap<string, string>): void => {
  switch (node.kind) {
    case "element":
      return renderElement(r, node, inScope(parentScope, node), parentOutput, []);
    case "text":
      r.out.push(escapeText(node.text));
      return;
    case "pi":
      r.out.push(node.data === "" ? `<?${node.target}?>` : `<?${node.target} ${node.data}?>`);
      return;
    case "comment":
      return;
  }
};

/**
 * `apex` canonicalized as the whole node-set, the way XML-DSig takes
 * `SignedInfo`: `ancestors` (root first, its parent last) supply the
 * namespaces in scope and, for the inclusive form, the inherited `xml:*`
 * attributes. A prefix that is never declared is not canonicalizable.
 */
export const canonicalize = (apex: XmlElement, ancestors: readonly XmlElement[], mode: C14nMode): C14nResult => {
  const scope = [...ancestors, apex].reduce<ReadonlyMap<string, string>>((s, e) => inScope(s, e), new Map());
  const own = new Set(apex.attributes.map((a) => a.name));
  const inherited =
    mode === "inclusive"
      ? [...ancestors]
          .reverse()
          .flatMap((e) => e.attributes.filter((a) => a.name.startsWith("xml:")))
          .filter((a, i, all) => !own.has(a.name) && all.findIndex((b) => b.name === a.name) === i)
      : [];
  const r: Rendering = { out: [], mode };
  try {
    renderElement(r, apex, scope, new Map(), inherited);
    return { ok: true, bytes: r.out.join("") };
  } catch (thrown) {
    const unbound = (thrown as { unbound?: unknown }).unbound;
    if (typeof unbound === "string") return { ok: false, why: `the prefix "${unbound}" is used without a declaration` };
    throw thrown;
  }
};
