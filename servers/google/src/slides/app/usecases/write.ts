import { targetId } from "../../../drive/app/usecases/browse.js";
import { shape } from "../../../drive/domain/entries.js";
import { finishCreated } from "../../../editors/app/created.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { deckLink, layoutsOf } from "../../domain/deck.js";
import { required } from "../../domain/errors.js";
import { buildOutline, checkOutline, fillRequests, notesRequests, type OutlineSlide, tag } from "../../domain/outline.js";
import type { Deps } from "../ports.js";

/**
 * A deck from a template and an outline.
 *
 * The outline is checked against the TEMPLATE's layouts before anything is
 * made. Then Drive copies the template (the Drive product's own copy, straight
 * into the folder), one batch builds the slides and deletes the template's
 * own, and a second batch writes the speaker notes, whose shapes only exist
 * once the slides do. Both batches are pinned to the revision they were
 * computed from.
 */
export const createDeckFromOutline = async (
  deps: Deps,
  args: {
    readonly templateId: string;
    readonly title: string;
    readonly outline: readonly OutlineSlide[];
    readonly keepTemplateSlides: boolean;
    readonly folderId: string;
    readonly folderPath: string;
  },
) => {
  const templateId = fileIdFrom(args.templateId);
  checkOutline(layoutsOf(await deps.slides.get(templateId)), args.outline);
  const parentId = await targetId(deps.drive, args.folderId, args.folderPath);
  const made = shape(await deps.drive.drive.copy(templateId, args.title, parentId));
  const link = made.link ?? deckLink(made.id);

  return finishCreated({ id: made.id, link }, "deck", async () => {
    const copy = await deps.slides.get(made.id);
    const existing = (copy.slides ?? []).map((s) => required(s.objectId, "slide objectId"));
    const built = buildOutline(layoutsOf(copy), args.outline, existing, { nonce: deps.nonce(), keepExisting: args.keepTemplateSlides });
    await deps.slides.batchUpdate(made.id, built.requests, required(copy.revisionId, "revisionId"));
    if (built.slides.some((s) => s.notes)) {
      const after = await deps.slides.get(made.id);
      await deps.slides.batchUpdate(made.id, notesRequests(after, built.slides), required(after.revisionId, "revisionId"));
    }
    return {
      presentationId: made.id,
      title: made.name,
      link,
      slides: built.slides.length,
      templateSlidesDeleted: args.keepTemplateSlides ? 0 : existing.length,
    };
  });
};

/** Every `{{tag}}` replaced by its value across the deck (or the slides named), and how many of each were found. */
export const fillPlaceholders = async (
  deps: Deps,
  args: { readonly presentationId: string; readonly values: Readonly<Record<string, string>>; readonly slideIds: readonly string[] },
) => {
  const id = fileIdFrom(args.presentationId);
  const reply = await deps.slides.batchUpdate(id, fillRequests(args.values, args.slideIds));
  const counts = Object.keys(args.values).map((key, i) => [tag(key), reply.replies?.[i]?.replaceAllText?.occurrencesChanged ?? 0] as const);
  return {
    presentationId: id,
    replaced: Object.fromEntries(counts),
    notFound: counts.filter(([, n]) => n === 0).map(([t]) => t),
  };
};
