import { required } from "./errors.js";
import type { RawPage, RawPageElement, RawPresentation, RawTextContent } from "./schema.js";

/** A layout and the placeholders a slide made from it has, which is what an outline can fill. */
export type Layout = {
  readonly id: string;
  /** The layout's own name ("TITLE_AND_BODY"), stable across languages. */
  readonly name: string;
  /** What the editor shows ("Title and body"), and what a template author renamed it to. */
  readonly displayName: string;
  readonly placeholders: readonly { readonly type: string; readonly index: number; readonly objectId: string }[];
};

export type SlideText = {
  readonly index: number;
  readonly objectId: string;
  readonly layout: string | null;
  readonly title: string;
  /** Every other text on the slide, in the deck's order: text boxes, placeholders, table rows. */
  readonly texts: readonly string[];
  readonly notes: string;
};

export const deckLink = (presentationId: string): string => `https://docs.google.com/presentation/d/${presentationId}/edit`;

export const TITLE_TYPES = new Set(["TITLE", "CENTERED_TITLE"]);

/** The words in a shape: its runs, paragraphs kept apart by their newlines. */
export const textOf = (text: RawTextContent | undefined): string =>
  (text?.textElements ?? [])
    .map((e) => e.textRun?.content ?? "")
    .join("")
    .replace(/\n+$/, "");

/** Elements inside groups too, depth first, in the order the slide lists them. */
const flatten = (elements: readonly RawPageElement[] | undefined): readonly RawPageElement[] =>
  (elements ?? []).flatMap((e) => (e.elementGroup ? flatten(e.elementGroup.children) : [e]));

const tableText = (element: RawPageElement): readonly string[] =>
  (element.table?.tableRows ?? []).map((row) => (row.tableCells ?? []).map((cell) => textOf(cell.text)).join(" | "));

export const layoutsOf = (deck: RawPresentation): readonly Layout[] =>
  (deck.layouts ?? []).map((layout) => ({
    id: required(layout.objectId, "layout objectId"),
    name: layout.layoutProperties?.name ?? "",
    displayName: layout.layoutProperties?.displayName ?? "",
    placeholders: flatten(layout.pageElements).flatMap((e) =>
      e.shape?.placeholder?.type ? [{ type: e.shape.placeholder.type, index: e.shape.placeholder.index ?? 0, objectId: required(e.objectId, "placeholder objectId") }] : [],
    ),
  }));

/** The speaker notes: the text of the shape the notes page names as holding them, absent until someone writes some. */
const notesOf = (slide: RawPage): string => {
  const page = slide.slideProperties?.notesPage;
  const id = page?.notesProperties?.speakerNotesObjectId;
  return textOf(flatten(page?.pageElements).find((e) => e.objectId === id)?.shape?.text);
};

/** Every slide's words: its title, its other texts, its speaker notes. Images and charts have none and are left out. */
export const slidesOf = (deck: RawPresentation): readonly SlideText[] => {
  const layoutNames = new Map((deck.layouts ?? []).map((l) => [l.objectId, l.layoutProperties?.displayName ?? l.layoutProperties?.name ?? null]));
  return (deck.slides ?? []).map((slide, index) => {
    const elements = flatten(slide.pageElements);
    const title = elements.find((e) => TITLE_TYPES.has(e.shape?.placeholder?.type ?? ""));
    return {
      index,
      objectId: required(slide.objectId, "slide objectId"),
      layout: layoutNames.get(slide.slideProperties?.layoutObjectId) ?? null,
      title: textOf(title?.shape?.text),
      texts: elements.filter((e) => e !== title).flatMap((e) => (e.table ? tableText(e) : e.shape?.text ? [textOf(e.shape.text)] : [])).filter(Boolean),
      notes: notesOf(slide),
    };
  });
};
