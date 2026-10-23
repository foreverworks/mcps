import { compact } from "../../editors/domain/compact.js";
import { deckLink } from "./deck.js";
import type { RawPage, RawPageElement, RawPresentation, RawTextContent } from "./schema.js";

/**
 * A deck's structure with every object id a request needs: each slide's
 * elements (shapes with their text and placeholder, images, tables cell by
 * cell, lines, videos, charts, groups), their size and transform, and the
 * speaker notes' shape. Sizes read "3000000 EMU" or "12pt"; requests take the
 * API's {magnitude, unit}. A shape's `text` is its text exactly, so offset k is
 * the insertionIndex or range index k. Pure.
 */

type Out = Record<string, unknown>;

const with_ = <K extends string>(key: K, value: unknown): Partial<Record<K, unknown>> =>
  value === undefined || value === null || value === "" ? {} : ({ [key]: value } as Record<K, unknown>);

/** A shape's whole text, including the newline Slides keeps at its end: indices count it. */
const fullText = (text: RawTextContent | null | undefined): string =>
  (text?.textElements ?? []).map((e) => e.textRun?.content ?? e.autoText?.content ?? "").join("");

const elementOut = (e: RawPageElement): Out => {
  const base: Out = {
    objectId: e.objectId,
    ...with_("title", e.title),
    ...with_("description", e.description),
    ...with_("size", compact(e.size)),
    ...with_("transform", compact(e.transform)),
  };
  if (e.shape) {
    const placeholder = e.shape.placeholder;
    return {
      ...base,
      type: "shape",
      shapeType: e.shape.shapeType,
      ...(placeholder?.type ? { placeholder: { type: placeholder.type, ...with_("index", placeholder.index), ...with_("parentObjectId", placeholder.parentObjectId) } } : {}),
      ...with_("text", fullText(e.shape.text)),
    };
  }
  if (e.image) return { ...base, type: "image", ...with_("sourceUrl", e.image.sourceUrl), ...with_("placeholder", compact(e.image.placeholder)) };
  if (e.table) {
    return {
      ...base,
      type: "table",
      rows: e.table.rows,
      columns: e.table.columns,
      cells: (e.table.tableRows ?? []).map((row) =>
        (row.tableCells ?? []).map((cell) => ({
          ...with_("text", fullText(cell.text)),
          ...(cell.rowSpan && cell.rowSpan > 1 ? { rowSpan: cell.rowSpan } : {}),
          ...(cell.columnSpan && cell.columnSpan > 1 ? { columnSpan: cell.columnSpan } : {}),
        })),
      ),
    };
  }
  if (e.line) return { ...base, type: "line", ...with_("lineCategory", e.line.lineCategory), ...with_("lineType", e.line.lineType) };
  if (e.video) return { ...base, type: "video", ...with_("source", e.video.source), ...with_("videoId", e.video.id) };
  if (e.sheetsChart) return { ...base, type: "sheetsChart", spreadsheetId: e.sheetsChart.spreadsheetId, chartId: e.sheetsChart.chartId };
  if (e.elementGroup) return { ...base, type: "group", children: (e.elementGroup.children ?? []).map(elementOut) };
  if (e.wordArt) return { ...base, type: "wordArt", ...with_("text", e.wordArt.renderedText) };
  const key = Object.keys(e).find((k) => !["objectId", "title", "description", "size", "transform"].includes(k));
  return { ...base, type: key ?? "unknown" };
};

const notesOut = (slide: RawPage): Out | undefined => {
  const page = slide.slideProperties?.notesPage;
  const id = page?.notesProperties?.speakerNotesObjectId;
  if (!id) return undefined;
  const shape = (page?.pageElements ?? []).find((e) => e.objectId === id);
  return { speakerNotesObjectId: id, ...with_("text", fullText(shape?.shape?.text)) };
};

const slideOut = (slide: RawPage, index: number): Out => ({
  objectId: slide.objectId,
  index,
  ...with_("layoutObjectId", slide.slideProperties?.layoutObjectId),
  ...(slide.slideProperties?.isSkipped ? { skipped: true } : {}),
  ...with_("background", compact(slide.pageProperties?.pageBackgroundFill)),
  elements: (slide.pageElements ?? []).map(elementOut),
  ...with_("notes", notesOut(slide)),
});

export type OutlineOptions = {
  /** Only these slides, by object id; every slide when empty. */
  readonly slideIds: readonly string[];
  /** The first slide to show, by position: where a cut outline goes on. */
  readonly fromSlide: number;
  readonly maxChars: number;
};

export const presentationOutline = (deck: RawPresentation, options: OutlineOptions): Out => {
  const all = (deck.slides ?? []).map((slide, index) => ({ slide, index }));
  const chosen = all.filter(({ slide, index }) => index >= options.fromSlide && (options.slideIds.length === 0 || options.slideIds.includes(slide.objectId ?? "")));
  const slides: Out[] = [];
  let used = 0;
  let nextSlide: number | undefined;
  for (const { slide, index } of chosen) {
    const out = slideOut(slide, index);
    const size = JSON.stringify(out).length;
    if (slides.length > 0 && used + size > options.maxChars) {
      nextSlide = index;
      break;
    }
    slides.push(out);
    used += size;
  }
  const id = deck.presentationId ?? "";
  return {
    presentationId: id,
    title: deck.title ?? "",
    revisionId: deck.revisionId ?? null,
    link: deckLink(id),
    ...with_("locale", deck.locale),
    ...with_("pageSize", compact(deck.pageSize)),
    slideCount: all.length,
    slides,
    layouts: (deck.layouts ?? []).map((l) => ({
      objectId: l.objectId,
      ...with_("name", l.layoutProperties?.name),
      ...with_("displayName", l.layoutProperties?.displayName),
      ...with_("masterObjectId", l.layoutProperties?.masterObjectId),
    })),
    masters: (deck.masters ?? []).map((m) => ({ objectId: m.objectId, ...with_("displayName", m.masterProperties?.displayName) })),
    truncated: nextSlide !== undefined,
    ...(nextSlide !== undefined ? { nextSlide } : {}),
  };
};
