import { compact } from "../../editors/domain/compact.js";
import { fail, inputError } from "./errors.js";
import type { RawDocument, RawDocumentTab, RawElement, RawParagraph, RawParagraphElement, RawTab, RawTable } from "./schema.js";

/**
 * A document as its structure, with every index a request needs: what
 * get_document shows instead of the API's JSON, which repeats every default
 * style on every run and costs ten times the characters. Pure.
 *
 * Index arithmetic stays exact: a paragraph's `text` holds one U+FFFC for each
 * index a non-text element takes (an image, a footnote mark, a chip), so the
 * character at offset k of `text` is at index `range[0] + k`, and the
 * paragraph's closing newline is at `range[1] - 1`. Indices are UTF-16 code
 * units, which is what a JavaScript string counts.
 */

/** Stands in the text for each index a non-text element occupies. */
export const OBJECT_MARK = "￼";

type Json = Readonly<Record<string, unknown>>;
type Out = Record<string, unknown>;

const with_ = <K extends string>(key: K, value: unknown): Partial<Record<K, unknown>> =>
  value === undefined || value === null || value === "" ? {} : ({ [key]: value } as Record<K, unknown>);

const span = (start: number | null | undefined, end: number | null | undefined): readonly [number, number] => [start ?? 0, end ?? start ?? 0];

/** The characters an element puts in the text: its own, or one mark per index it takes. */
const elementText = (element: RawParagraphElement): string =>
  element.textRun ? (element.textRun.content ?? "") : OBJECT_MARK.repeat(Math.max(0, (element.endIndex ?? 0) - (element.startIndex ?? 0)));

const OBJECT_KEYS = ["startIndex", "endIndex", "textRun"];

/** A non-text paragraph element: what it is and its own ids. A kind Google adds later is still named, by its key. */
const objectOf = (element: RawParagraphElement): Out | undefined => {
  if (element.textRun) return undefined;
  const at = element.startIndex ?? 0;
  if (element.inlineObjectElement) return { at, type: "inlineObject", objectId: element.inlineObjectElement.inlineObjectId };
  if (element.footnoteReference) {
    return { at, type: "footnoteReference", footnoteId: element.footnoteReference.footnoteId, ...with_("number", element.footnoteReference.footnoteNumber) };
  }
  if (element.person) return { at, type: "person", ...(compact(element.person.personProperties) as Json | undefined) };
  if (element.richLink) return { at, type: "richLink", ...(compact(element.richLink.richLinkProperties) as Json | undefined) };
  if (element.autoText) return { at, type: "autoText", ...with_("autoTextType", element.autoText.type) };
  if (element.dateElement) return { at, type: "date", ...(compact((element.dateElement as Json).dateElementProperties) as Json | undefined) };
  const key = Object.keys(element).find((k) => !OBJECT_KEYS.includes(k));
  return { at, type: key ?? "unknown" };
};

const suggestions = (holder: { readonly suggestedInsertionIds?: readonly string[] | null; readonly suggestedDeletionIds?: readonly string[] | null }): Out => ({
  ...(holder.suggestedInsertionIds?.length ? { suggestedInsertionIds: holder.suggestedInsertionIds } : {}),
  ...(holder.suggestedDeletionIds?.length ? { suggestedDeletionIds: holder.suggestedDeletionIds } : {}),
});

/** A run worth listing: one with a style of its own, or a suggested change. Plain runs are the paragraph's text. */
const runOf = (element: RawParagraphElement): Out | undefined => {
  const run = element.textRun;
  if (!run) return undefined;
  const style = compact(run.textStyle);
  const marks = suggestions(run);
  if (style === undefined && Object.keys(marks).length === 0) return undefined;
  return { range: span(element.startIndex, element.endIndex), text: (run.content ?? "").replace(/\n$/, ""), ...with_("style", style), ...marks };
};

const paragraphOut = (element: RawElement, paragraph: RawParagraph): Out => {
  const elements = paragraph.elements ?? [];
  const { namedStyleType, headingId, direction, ...rest } = paragraph.paragraphStyle ?? {};
  const overrides = compact({ ...rest, ...(direction && direction !== "LEFT_TO_RIGHT" ? { direction } : {}) });
  const runs = elements.flatMap((e) => runOf(e) ?? []);
  const objects = elements.flatMap((e) => objectOf(e) ?? []);
  return {
    type: "paragraph",
    range: span(element.startIndex, element.endIndex),
    text: elements.map(elementText).join("").replace(/\n$/, ""),
    ...(namedStyleType && namedStyleType !== "NORMAL_TEXT" ? { style: namedStyleType } : {}),
    ...with_("headingId", headingId),
    ...(paragraph.bullet ? { bullet: { listId: paragraph.bullet.listId, level: paragraph.bullet.nestingLevel ?? 0 } } : {}),
    ...with_("paragraphStyle", overrides),
    ...(runs.length > 0 ? { runs } : {}),
    ...(objects.length > 0 ? { objects } : {}),
    ...(paragraph.positionedObjectIds?.length ? { positionedObjectIds: paragraph.positionedObjectIds } : {}),
  };
};

/**
 * The value most items share, and the items that differ: a table's cells all
 * carry the same padding and borders, and saying it once per table is what
 * keeps a table readable.
 */
const shared = (styles: readonly unknown[]): { readonly common: unknown; readonly key: string } => {
  const counts = new Map<string, number>();
  for (const s of styles) {
    const key = JSON.stringify(s ?? null);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key = "null"] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return { common: JSON.parse(key) as unknown, key };
};

const tableOut = (element: RawElement, table: RawTable): Out => {
  const rows = table.tableRows ?? [];
  const cellStyles = rows.map((row) =>
    (row.tableCells ?? []).map((cell) => {
      const { rowSpan, columnSpan, ...style } = cell.tableCellStyle ?? {};
      return { style: compact(style), rowSpan: rowSpan ?? 1, columnSpan: columnSpan ?? 1 };
    }),
  );
  const cell = shared(cellStyles.flat().map((c) => c.style));
  const row = shared(rows.map((r) => compact(r.tableRowStyle)));
  return {
    type: "table",
    range: span(element.startIndex, element.endIndex),
    rows: table.rows ?? rows.length,
    columns: table.columns ?? 0,
    ...with_("tableStyle", compact(table.tableStyle)),
    ...with_("cellStyle", cell.common ?? undefined),
    ...with_("rowStyle", row.common ?? undefined),
    ...suggestions(table),
    cells: rows.map((r, i) => {
      const rowStyle = compact(r.tableRowStyle);
      return {
        range: span(r.startIndex, r.endIndex),
        ...(JSON.stringify(rowStyle ?? null) === row.key ? {} : with_("rowStyle", rowStyle)),
        cells: (r.tableCells ?? []).map((c, j) => {
          const styled = cellStyles[i]?.[j];
          return {
            range: span(c.startIndex, c.endIndex),
            ...(styled && styled.rowSpan !== 1 ? { rowSpan: styled.rowSpan } : {}),
            ...(styled && styled.columnSpan !== 1 ? { columnSpan: styled.columnSpan } : {}),
            ...(JSON.stringify(styled?.style ?? null) === cell.key ? {} : with_("style", styled?.style)),
            content: contentOut(c.content ?? []),
          };
        }),
      };
    }),
  };
};

const elementOut = (element: RawElement): Out => {
  if (element.paragraph) return paragraphOut(element, element.paragraph);
  if (element.table) return tableOut(element, element.table);
  if (element.sectionBreak) return { type: "sectionBreak", range: span(element.startIndex, element.endIndex), ...with_("sectionStyle", compact(element.sectionBreak.sectionStyle)) };
  if (element.tableOfContents) {
    return { type: "tableOfContents", range: span(element.startIndex, element.endIndex), content: contentOut(element.tableOfContents.content ?? []) };
  }
  return { type: Object.keys(element).find((k) => k !== "startIndex" && k !== "endIndex") ?? "unknown", range: span(element.startIndex, element.endIndex) };
};

export const contentOut = (content: readonly RawElement[]): readonly Out[] => content.map(elementOut);

// ---------------------------------------------------------------------------
// Tabs

export type TabRow = {
  readonly tabId: string;
  readonly title: string;
  readonly index: number;
  /** 0 for a top-level tab, 1 for its child, and so on. */
  readonly level: number;
  readonly parentTabId?: string;
  readonly iconEmoji?: string;
};

export type TabContent = { readonly row: TabRow; readonly content: RawDocumentTab };

/**
 * Every tab, depth first, as Docs orders them in its sidebar. A document read
 * without tabs content (or from before tabs) is one tab with an empty id: its
 * requests then name no tabId and land in the first tab.
 */
export const tabsOf = (doc: RawDocument): readonly TabContent[] => {
  const walk = (tabs: readonly RawTab[], level: number): readonly TabContent[] =>
    tabs.flatMap((tab) => {
      const p = tab.tabProperties ?? {};
      const row: TabRow = {
        tabId: p.tabId ?? "",
        title: p.title ?? "",
        index: p.index ?? 0,
        level,
        ...(p.parentTabId ? { parentTabId: p.parentTabId } : {}),
        ...(p.iconEmoji ? { iconEmoji: p.iconEmoji } : {}),
      };
      return [{ row, content: tab.documentTab ?? {} }, ...walk(tab.childTabs ?? [], level + 1)];
    });
  if (doc.tabs && doc.tabs.length > 0) return walk(doc.tabs, 0);
  return [{ row: { tabId: "", title: doc.title ?? "", index: 0, level: 0 }, content: doc as RawDocumentTab }];
};

/** The tab a caller named: by id, or by a title only one tab has. Empty is the first tab. */
export const pickTab = (tabs: readonly TabContent[], selector: string): TabContent => {
  const wanted = selector.trim();
  if (wanted === "") return tabs[0] ?? fail(inputError("the document has no tabs"));
  const byId = tabs.find((t) => t.row.tabId === wanted);
  if (byId) return byId;
  const byTitle = tabs.filter((t) => t.row.title.trim().toLowerCase() === wanted.toLowerCase());
  if (byTitle.length === 1) return byTitle[0] as TabContent;
  const known = tabs.map((t) => `${t.row.tabId} "${t.row.title}"`).join(", ");
  return fail(inputError(byTitle.length > 1 ? `${byTitle.length} tabs are titled "${wanted}"; name one by id (${known})` : `no tab "${wanted}" (tabs: ${known})`));
};

// ---------------------------------------------------------------------------
// The outline get_document returns

export const PARTS = ["body", "headers", "footers", "footnotes", "lists", "named_ranges", "objects", "styles"] as const;
export type Part = (typeof PARTS)[number];

export type OutlineOptions = {
  readonly parts: readonly Part[];
  /** Only body elements that reach into [startIndex, endIndex). */
  readonly startIndex?: number;
  readonly endIndex?: number;
  /** The body is cut at an element boundary once its JSON passes this many characters. */
  readonly maxChars: number;
};

const segmentsOut = (segments: Readonly<Record<string, { readonly content?: readonly RawElement[] }>> | null | undefined) =>
  Object.fromEntries(Object.entries(segments ?? {}).map(([id, segment]) => [id, contentOut(segment.content ?? [])]));

const namedRangesOut = (tab: RawDocumentTab) =>
  Object.fromEntries(
    Object.entries(tab.namedRanges ?? {}).map(([name, group]) => [
      name,
      (group.namedRanges ?? []).map((r) => ({
        namedRangeId: r.namedRangeId,
        ranges: (r.ranges ?? []).map((x) => ({ range: span(x.startIndex, x.endIndex), ...with_("segmentId", x.segmentId), ...with_("tabId", x.tabId) })),
      })),
    ]),
  );

const objectsOut = (tab: RawDocumentTab): Out => ({
  ...with_("inlineObjects", compact(Object.fromEntries(Object.entries(tab.inlineObjects ?? {}).map(([id, o]) => [id, o.inlineObjectProperties?.embeddedObject])))),
  ...with_("positionedObjects", compact(Object.fromEntries(Object.entries(tab.positionedObjects ?? {}).map(([id, o]) => [id, o.positionedObjectProperties])))),
});

/** What the tab holds beyond the parts shown, so a model knows to ask for it. */
const elsewhere = (tab: RawDocumentTab, parts: readonly Part[]): Out => {
  const ids = (record: Readonly<Record<string, unknown>> | null | undefined) => Object.keys(record ?? {});
  const unshown: Out = {
    ...(parts.includes("headers") ? {} : with_("headers", ids(tab.headers).length ? ids(tab.headers) : undefined)),
    ...(parts.includes("footers") ? {} : with_("footers", ids(tab.footers).length ? ids(tab.footers) : undefined)),
    ...(parts.includes("footnotes") ? {} : with_("footnotes", ids(tab.footnotes).length || undefined)),
    ...(parts.includes("lists") ? {} : with_("lists", ids(tab.lists).length || undefined)),
    ...(parts.includes("named_ranges") ? {} : with_("namedRanges", ids(tab.namedRanges).length ? ids(tab.namedRanges) : undefined)),
    ...(parts.includes("objects") ? {} : with_("inlineObjects", ids(tab.inlineObjects).length || undefined)),
    ...(parts.includes("objects") ? {} : with_("positionedObjects", ids(tab.positionedObjects).length || undefined)),
  };
  return Object.keys(unshown).length > 0 ? { notShown: unshown } : {};
};

export type Outline = Out & { readonly truncated: boolean };

/** One tab's outline: the parts asked for, the body cut to the budget at an element boundary. */
export const outlineOf = (tab: RawDocumentTab, options: OutlineOptions): Outline => {
  const { parts } = options;
  const from = options.startIndex ?? 0;
  const to = options.endIndex ?? Number.POSITIVE_INFINITY;
  const body: Out[] = [];
  let used = 0;
  let nextIndex: number | undefined;
  if (parts.includes("body")) {
    for (const element of tab.body?.content ?? []) {
      const [start, end] = span(element.startIndex, element.endIndex);
      if (end <= from || start >= to) continue;
      const out = elementOut(element);
      const size = JSON.stringify(out).length;
      if (body.length > 0 && used + size > options.maxChars) {
        nextIndex = start;
        break;
      }
      body.push(out);
      used += size;
    }
  }
  const lists = parts.includes("lists")
    ? compact(Object.fromEntries(Object.entries(tab.lists ?? {}).map(([id, list]) => [id, list.listProperties?.nestingLevels])))
    : undefined;
  return {
    ...(parts.includes("body") ? { body } : {}),
    ...(parts.includes("headers") ? { headers: segmentsOut(tab.headers) } : {}),
    ...(parts.includes("footers") ? { footers: segmentsOut(tab.footers) } : {}),
    ...(parts.includes("footnotes") ? { footnotes: segmentsOut(tab.footnotes) } : {}),
    ...(parts.includes("lists") ? { lists: lists ?? {} } : {}),
    ...(parts.includes("named_ranges") ? { namedRanges: namedRangesOut(tab) } : {}),
    ...(parts.includes("objects") ? objectsOut(tab) : {}),
    ...(parts.includes("styles") ? { ...with_("documentStyle", compact(tab.documentStyle)), ...with_("namedStyles", compact(tab.namedStyles?.styles)) } : {}),
    ...elsewhere(tab, parts),
    truncated: nextIndex !== undefined,
    ...(nextIndex !== undefined ? { nextIndex } : {}),
  };
};
