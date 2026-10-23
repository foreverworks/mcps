import { type Layout, TITLE_TYPES } from "./deck.js";
import { fail, inputError, required } from "./errors.js";
import type { RawPresentation, SlidesRequest } from "./schema.js";

/** One slide of an outline: which layout, and what goes in its placeholders and notes. */
export type OutlineSlide = {
  readonly layout: string;
  readonly title?: string;
  readonly subtitle?: string;
  /** One string, or one per line (a bullet each, in a body placeholder that has bullets). */
  readonly body?: string | readonly string[];
  readonly notes?: string;
};

type Field = "title" | "subtitle" | "body";

/** Which placeholder each outline field fills. */
const PLACEHOLDER: Readonly<Record<Field, (type: string) => boolean>> = {
  title: (type) => TITLE_TYPES.has(type),
  subtitle: (type) => type === "SUBTITLE",
  body: (type) => type === "BODY",
};

const normalise = (s: string): string => s.trim().toLowerCase().replace(/[\s_]+/g, " ");

/** A layout by the name the editor shows or by its own name, case and underscores aside. */
export const findLayout = (layouts: readonly Layout[], name: string): Layout => {
  const wanted = normalise(name);
  const found = layouts.find((l) => normalise(l.displayName) === wanted) ?? layouts.find((l) => normalise(l.name) === wanted);
  return found ?? fail(inputError(`no layout "${name}" in the template (layouts: ${layouts.map((l) => l.displayName || l.name).join(", ")})`));
};

const fieldsOf = (slide: OutlineSlide): readonly Field[] =>
  (["title", "subtitle", "body"] as const).filter((f) => slide[f] !== undefined && slide[f] !== "");

/**
 * Every slide checked against the template's layouts before anything is
 * copied: a layout that does not exist, or a field its layout has no
 * placeholder for, fails the call while nothing has been made.
 */
export const checkOutline = (layouts: readonly Layout[], outline: readonly OutlineSlide[]): void => {
  if (outline.length === 0) fail(inputError("the outline has no slides"));
  outline.forEach((slide, i) => {
    const layout = findLayout(layouts, slide.layout);
    const missing = fieldsOf(slide).filter((f) => !layout.placeholders.some((p) => PLACEHOLDER[f](p.type)));
    if (missing.length > 0) {
      fail(
        inputError(
          `slide ${i + 1}: layout "${slide.layout}" has no ${missing.join(" or ")} placeholder ` +
            `(it has ${layout.placeholders.map((p) => p.type).join(", ") || "none"})`,
        ),
      );
    }
  });
};

/** Object ids are ours to choose, 5 to 50 characters of [A-Za-z0-9_-:]; choosing them is what lets one batch create a slide and fill it. */
const objectId = (nonce: string, slide: number, part: string): string => `${nonce}_${slide}_${part}`;

export type Built = {
  readonly requests: readonly SlidesRequest[];
  /** The slides made, with the notes each is to get once Slides has given it a notes shape. */
  readonly slides: readonly { readonly objectId: string; readonly notes?: string }[];
};

/**
 * The outline as one batch: each slide created from its layout with our ids
 * mapped onto its placeholders, the placeholders filled, and (unless kept)
 * the template's own slides deleted afterwards, so the deck is never empty
 * in between. Speaker notes cannot go in this batch: a new slide's notes
 * shape gets its id from Slides (notesRequests).
 */
export const buildOutline = (
  layouts: readonly Layout[],
  outline: readonly OutlineSlide[],
  existingSlideIds: readonly string[],
  options: { readonly nonce: string; readonly keepExisting: boolean },
): Built => {
  checkOutline(layouts, outline);
  const insertAt = existingSlideIds.length;
  const perSlide = outline.map((slide, i) => {
    const layout = findLayout(layouts, slide.layout);
    const id = objectId(options.nonce, i, "slide");
    const fills = fieldsOf(slide).map((field) => {
      const placeholder = layout.placeholders.find((p) => PLACEHOLDER[field](p.type)) as Layout["placeholders"][number];
      const value = slide[field];
      return { field, placeholder, id: objectId(options.nonce, i, field), text: Array.isArray(value) ? value.join("\n") : (value as string) };
    });
    const create: SlidesRequest = {
      createSlide: {
        objectId: id,
        insertionIndex: insertAt + i,
        slideLayoutReference: { layoutId: layout.id },
        placeholderIdMappings: fills.map((f) => ({ layoutPlaceholder: { type: f.placeholder.type, index: f.placeholder.index }, objectId: f.id })),
      },
    };
    const inserts: readonly SlidesRequest[] = fills.filter((f) => f.text).map((f) => ({ insertText: { objectId: f.id, insertionIndex: 0, text: f.text } }));
    return { requests: [create, ...inserts], slide: { objectId: id, ...(slide.notes ? { notes: slide.notes } : {}) } };
  });
  const deletes: readonly SlidesRequest[] = options.keepExisting ? [] : existingSlideIds.map((id) => ({ deleteObject: { objectId: id } }));
  return { requests: [...perSlide.flatMap((s) => s.requests), ...deletes], slides: perSlide.map((s) => s.slide) };
};

/** Speaker notes into the notes shapes Slides gave the new slides. Inserting into that id creates the shape if it is not there yet. */
export const notesRequests = (deck: RawPresentation, slides: Built["slides"]): readonly SlidesRequest[] => {
  const notesShape = new Map((deck.slides ?? []).map((s) => [s.objectId, s.slideProperties?.notesPage?.notesProperties?.speakerNotesObjectId]));
  return slides.flatMap((slide) =>
    slide.notes ? [{ insertText: { objectId: required(notesShape.get(slide.objectId), `speaker notes id of ${slide.objectId}`), insertionIndex: 0, text: slide.notes } }] : [],
  );
};

/** `{{name}}` tags, and the replaceAllText request for each: exact case, across every slide or the ones named. */
export const tag = (key: string): string => (key.startsWith("{{") && key.endsWith("}}") ? key : `{{${key}}}`);

export const fillRequests = (values: Readonly<Record<string, string>>, pageIds: readonly string[]): readonly SlidesRequest[] =>
  Object.entries(values).map(([key, value]) => ({
    replaceAllText: {
      containsText: { text: tag(key), matchCase: true },
      replaceText: value,
      ...(pageIds.length ? { pageObjectIds: [...pageIds] } : {}),
    },
  }));
