import { type Block, type Cell, type Inline, LINE_BREAK, MAX_HEADING, mergeInlines } from "./blocks.js";
import { required } from "./errors.js";
import type { RawDocument, RawElement, RawList, RawParagraph, RawParagraphElement, RawTextStyle } from "./schema.js";
import type { Positioned } from "./toMarkdown.js";

/** A block and where it sits in the document, in Docs' UTF-16 indices. */
export type Located = Positioned & {
  readonly start: number;
  readonly end: number;
  /** A heading's own id: Docs keeps it while the heading exists, whatever is edited around it. */
  readonly headingId?: string;
};

/**
 * Something in the document that markdown cannot carry and a read leaves out
 * (an image, a footnote, an equation), and where it is. An edit that deletes
 * the range it sits in deletes it too, so an edit is told before it does.
 */
export type Hidden = { readonly kind: string; readonly index: number };

/** A document read into blocks, with what an edit needs to know about its end. */
export type DocModel = {
  readonly documentId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly blocks: readonly Located[];
  /** The body's end index. The last newline, at end - 1, can never be deleted. */
  readonly end: number;
  /** Whether the body ends in an empty paragraph, which new content can take over instead of adding another. */
  readonly tailEmpty: boolean;
  /** What the blocks leave out, in document order. */
  readonly hidden: readonly Hidden[];
};

/** The paragraph elements a read leaves out, by the name a person knows them by. */
const HIDDEN_ELEMENTS = [
  ["inlineObjectElement", "image"],
  ["footnoteReference", "footnote"],
  ["equation", "equation"],
  ["horizontalRule", "horizontal rule"],
  ["pageBreak", "page break"],
  ["columnBreak", "column break"],
  ["autoText", "page number"],
  ["dateElement", "date chip"],
] as const;

/** Everything in `content` that markdown cannot carry, table cells included. */
const hiddenIn = (content: readonly RawElement[]): readonly Hidden[] =>
  content.flatMap((element): readonly Hidden[] => {
    const at = element.startIndex ?? 0;
    if (element.paragraph) {
      const floating = (element.paragraph.positionedObjectIds ?? []).map(() => ({ kind: "positioned image", index: at }));
      const inline = (element.paragraph.elements ?? []).flatMap((e) =>
        HIDDEN_ELEMENTS.flatMap(([key, kind]) => (e[key] ? [{ kind, index: e.startIndex ?? at }] : [])),
      );
      return [...floating, ...inline];
    }
    if (element.table) return (element.table.tableRows ?? []).flatMap((row) => (row.tableCells ?? []).flatMap((cell) => hiddenIn(cell.content ?? [])));
    if (element.tableOfContents) return [{ kind: "table of contents", index: at }];
    if (element.sectionBreak && at > 0) return [{ kind: "section break", index: at }];
    return [];
  });

/** What lies in [start, end), counted by kind: "2 images, 1 footnote". Empty when nothing does. */
export const hiddenBetween = (model: DocModel, start: number, end: number): string => {
  const counts = new Map<string, number>();
  for (const h of model.hidden) if (h.index >= start && h.index < end) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`).join(", ");
};

/** A run in a monospace face is code: Docs has no code style, so the font is the only signal. */
const MONOSPACE = /mono|courier|consolas|menlo|monaco|inconsolata|source code|fira code|cousine/i;

const ORDERED_GLYPHS = new Set(["DECIMAL", "ZERO_DECIMAL", "UPPER_ALPHA", "ALPHA", "UPPER_ROMAN", "ROMAN"]);

const styleOf = (style: RawTextStyle | undefined): Omit<Inline, "text"> => {
  const url = style?.link?.url ?? (style?.link?.headingId ? `#${style.link.headingId}` : undefined);
  const font = style?.weightedFontFamily?.fontFamily ?? "";
  return {
    ...(style?.bold ? { bold: true as const } : {}),
    ...(style?.italic ? { italic: true as const } : {}),
    ...(style?.strikethrough ? { strike: true as const } : {}),
    ...(MONOSPACE.test(font) ? { code: true as const } : {}),
    ...(url ? { link: url } : {}),
  };
};

/**
 * One paragraph element as runs. Text, people and rich links (a Drive file
 * chip) carry words; images, footnote markers, equations, page and column
 * breaks and rules do not, and are left out rather than rendered as a
 * placeholder a reader could mistake for text.
 */
const inlinesOf = (element: RawParagraphElement): readonly Inline[] => {
  if (element.textRun) {
    const text = (element.textRun.content ?? "").replace(/\n$/, "").replace(/\u000b/g, LINE_BREAK);
    return text ? [{ text, ...styleOf(element.textRun.textStyle) }] : [];
  }
  if (element.person) {
    const { name, email } = element.person.personProperties ?? {};
    const text = name ?? email ?? "";
    return text ? [{ text, ...(email ? { link: `mailto:${email}` } : {}) }] : [];
  }
  if (element.richLink) {
    const { title, uri } = element.richLink.richLinkProperties ?? {};
    const text = title ?? uri ?? "";
    return text ? [{ text, ...(uri ? { link: uri } : {}) }] : [];
  }
  return [];
};

const paragraphInlines = (paragraph: RawParagraph): readonly Inline[] => mergeInlines((paragraph.elements ?? []).flatMap(inlinesOf));

const headingLevel = (namedStyle: string | null | undefined): number | undefined => {
  if (namedStyle === "TITLE") return 1;
  const match = /^HEADING_(\d)$/.exec(namedStyle ?? "");
  const level = match ? Number(match[1]) : undefined;
  return level !== undefined && level >= 1 && level <= MAX_HEADING ? level : undefined;
};

/** Whether a list's glyph at this depth is a number or letter rather than a bullet. Absent means a bullet. */
const isOrdered = (lists: Readonly<Record<string, RawList>> | undefined, listId: string, depth: number): boolean => {
  const level = lists?.[listId]?.listProperties?.nestingLevels?.[depth];
  return level?.glyphSymbol ? false : ORDERED_GLYPHS.has(level?.glyphType ?? "");
};

const cellOf = (content: readonly RawElement[] | undefined): Cell =>
  (content ?? []).flatMap((e) => (e.paragraph ? [paragraphInlines(e.paragraph)] : []));

/**
 * A header row that is bold throughout reads as a plain markdown header row:
 * markdown shows a header bold without saying so, and the writer makes it bold
 * for the same reason (toRequests.ts). Without this, every round trip would add
 * a pair of ** to each header cell.
 */
const unboldHeader = (rows: readonly (readonly Cell[])[]): readonly (readonly Cell[])[] => {
  const [header, ...rest] = rows;
  const runs = (header ?? []).flat(2);
  if (!header || runs.length === 0 || !runs.every((r) => r.bold)) return rows;
  const plain = header.map((cell) => cell.map((p) => mergeInlines(p.map(({ bold: _, ...r }) => r))));
  return [plain, ...rest];
};

const paragraphBlock = (
  paragraph: RawParagraph,
  lists: Readonly<Record<string, RawList>> | undefined,
): { readonly block: Block; readonly listId?: string; readonly headingId?: string } | undefined => {
  const inlines = paragraphInlines(paragraph);
  const style = paragraph.paragraphStyle;
  const level = headingLevel(style?.namedStyleType);
  if (level !== undefined) {
    return { block: { kind: "heading", level, inlines }, ...(style?.headingId ? { headingId: style.headingId } : {}) };
  }
  if (paragraph.bullet) {
    const listId = paragraph.bullet.listId ?? "";
    const depth = paragraph.bullet.nestingLevel ?? 0;
    return { block: { kind: "item", ordered: isOrdered(lists, listId, depth), depth, inlines }, listId };
  }
  // An empty paragraph is spacing, not content.
  if (inlines.length === 0) return undefined;
  if (inlines.every((i) => i.code && !i.link)) return { block: { kind: "code", text: inlines.map((i) => i.text).join("") } };
  return { block: { kind: "paragraph", inlines } };
};

const located = (element: RawElement, lists: Readonly<Record<string, RawList>> | undefined): Located | undefined => {
  const start = element.startIndex ?? 0;
  const end = required(element.endIndex, "element endIndex");
  if (element.paragraph) {
    const made = paragraphBlock(element.paragraph, lists);
    return made ? { ...made, start, end } : undefined;
  }
  if (element.table) {
    const rows = (element.table.tableRows ?? []).map((row) => (row.tableCells ?? []).map((cell) => cellOf(cell.content)));
    return { block: { kind: "table", rows: unboldHeader(rows) }, start, end };
  }
  // Section breaks and tables of contents have no words of their own.
  return undefined;
};

/**
 * A document as blocks. This reads the body Docs returns without
 * `includeTabsContent`, which is the FIRST tab of a document that has tabs:
 * the same body the edit requests below address when they name no tab.
 */
export const readDocument = (raw: RawDocument): DocModel => {
  const content = raw.body?.content ?? [];
  const last = content[content.length - 1];
  const tail = last?.paragraph?.elements ?? [];
  return {
    documentId: required(raw.documentId, "documentId"),
    title: raw.title ?? "",
    revisionId: required(raw.revisionId, "revisionId"),
    blocks: content.flatMap((element) => located(element, raw.lists ?? undefined) ?? []),
    end: required(last?.endIndex, "body endIndex"),
    tailEmpty: last?.paragraph !== undefined && tail.length === 1 && tail[0]?.textRun?.content === "\n",
    hidden: hiddenIn(content),
  };
};

export const docLink = (documentId: string): string => `https://docs.google.com/document/d/${documentId}/edit`;
