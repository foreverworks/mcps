import { targetId } from "../../../drive/app/usecases/browse.js";
import { PRESENTATION_MIME, shape } from "../../../drive/domain/entries.js";
import type { FileSource } from "@foreverworks/mcp-kit";

import { withStagedImages } from "../../../editors/app/images.js";
import { checked, repliesOf, staleRevision } from "../../../editors/domain/batch.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { SLIDES_API } from "../../domain/api.js";
import { deckLink } from "../../domain/deck.js";
import { asAppError, fail, inputError } from "../../domain/errors.js";
import { presentationOutline } from "../../domain/structure.js";
import type { Deps } from "../ports.js";

export type GetArgs = {
  readonly presentationId: string;
  readonly format: "outline" | "raw";
  readonly slideIds: readonly string[];
  readonly fromSlide: number;
  readonly fields: string;
  readonly maxChars: number;
};

/** The deck's structure with every object id (outline), or the API's JSON narrowed by a field mask (raw). */
export const getPresentation = async (deps: Deps, args: GetArgs) => {
  const id = fileIdFrom(args.presentationId);
  if (args.format === "outline") {
    return presentationOutline(await deps.slides.get(id), { slideIds: args.slideIds, fromSlide: args.fromSlide, maxChars: args.maxChars });
  }
  const raw = await deps.slides.get(id, args.fields || undefined);
  const size = JSON.stringify(raw).length;
  if (size > args.maxChars) {
    return fail(
      inputError(
        `the raw presentation is ${size} characters, over max_chars ${args.maxChars}: narrow it with fields ` +
          '(e.g. "slides(objectId,pageElements(objectId,shape(text)))"), raise max_chars, or read format outline',
      ),
    );
  }
  return { presentationId: id, link: deckLink(id), presentation: raw };
};

/**
 * Any requests the Slides API takes, as one batchUpdate: all apply or none do.
 * Checked against the API's schema first. Slides names objects by id rather
 * than by position, so a pin is optional: with expected_revision the batch is
 * refused if the deck changed since it was read.
 */
export const batchUpdatePresentation = async (
  deps: Deps,
  args: {
    readonly presentationId: string;
    readonly requests: readonly unknown[];
    readonly expectedRevision: string;
    /** Local images the requests name as "image:<name>". */
    readonly images: Readonly<Record<string, FileSource>>;
  },
) => {
  const requests = checked(SLIDES_API, args.requests);
  const id = fileIdFrom(args.presentationId);
  const pinned = args.expectedRevision.trim();
  try {
    const { result: answer, images } = await withStagedImages(deps.drive, args.images, requests, (ready) => deps.slides.apply(id, ready, pinned || undefined));
    return {
      presentationId: answer.presentationId ?? id,
      link: deckLink(answer.presentationId ?? id),
      revisionId: answer.writeControl?.requiredRevisionId ?? null,
      applied: requests.length,
      replies: repliesOf(answer.replies),
      ...(images.length > 0 ? { images } : {}),
    };
  } catch (thrown) {
    const stale = staleRevision(asAppError(thrown), !!pinned);
    if (stale) return fail(stale);
    throw thrown;
  }
};

/**
 * A blank deck made by Drive directly in its folder, for batch_update_presentation
 * to build on. Slides gives a new deck one title slide, which the answer names.
 */
export const createPresentation = async (deps: Deps, args: { readonly title: string; readonly folderId: string; readonly folderPath: string }) => {
  const parentId = await targetId(deps.drive, args.folderId, args.folderPath);
  const made = shape(await deps.drive.drive.createFile(args.title, PRESENTATION_MIME, parentId));
  const deck = await deps.slides.get(made.id, "presentationId,revisionId,slides(objectId)");
  return {
    presentationId: made.id,
    title: made.name,
    link: made.link ?? deckLink(made.id),
    revisionId: deck.revisionId ?? null,
    slides: (deck.slides ?? []).map((s) => s.objectId ?? ""),
  };
};
