import { mapWithConcurrency } from "@foreverworks/mcp-kit";

import { fileIdFrom } from "../../../editors/domain/ids.js";
import { deckLink, layoutsOf, slidesOf } from "../../domain/deck.js";
import { required } from "../../domain/errors.js";
import type { Deps, ThumbnailSize } from "../ports.js";

/**
 * Thumbnails are an "expensive read" in the Slides quota, counted per minute
 * per project; four in flight renders a 20-slide deck in a few seconds
 * without spending the minute's budget in one burst.
 */
const THUMBNAIL_CONCURRENCY = 4;

export const listLayouts = async (deps: Deps, args: { readonly presentationId: string }) => {
  const id = fileIdFrom(args.presentationId);
  const deck = await deps.slides.get(id);
  return { presentationId: id, title: deck.title ?? "", layouts: layoutsOf(deck) };
};

export const readDeck = async (deps: Deps, args: { readonly presentationId: string }) => {
  const id = fileIdFrom(args.presentationId);
  const deck = await deps.slides.get(id);
  return { presentationId: id, title: deck.title ?? "", revisionId: deck.revisionId ?? null, link: deckLink(id), slides: slidesOf(deck) };
};

/** One PNG URL per slide. The URLs are Google's and expire (about half an hour); fetch them promptly. */
export const getThumbnails = async (deps: Deps, args: { readonly presentationId: string; readonly size: ThumbnailSize }) => {
  const id = fileIdFrom(args.presentationId);
  const slides = (await deps.slides.get(id)).slides ?? [];
  const thumbnails = await mapWithConcurrency(slides, THUMBNAIL_CONCURRENCY, async (slide, index) => {
    const pageId = required(slide.objectId, "slide objectId");
    const shot = await deps.slides.thumbnail(id, pageId, args.size);
    return { index, objectId: pageId, url: required(shot.contentUrl, "thumbnail contentUrl"), width: shot.width ?? null, height: shot.height ?? null };
  });
  return { presentationId: id, size: args.size, thumbnails };
};
