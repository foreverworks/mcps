import { z } from "zod";

import { fileIdArg, folderArgs, type ImageArgs, imageSources, imagesArg, readAccountArg, requestsArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { batchUpdatePresentation, createPresentation, getPresentation } from "../../app/usecases/api.js";
import type { Registry } from "../../composition.js";
import { SLIDES_API } from "../../domain/api.js";
import { handled } from "../envelope.js";

/** Slides' full API: the structure with every object id, and any batchUpdate request. */
export const registerApi: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "get_presentation",
    {
      title: "Read a deck's structure",
      description:
        "A Google Slides deck's structure with the object ids batch_update_presentation needs: per slide its layout, every element " +
        "(shapes with type, placeholder and full text, images, tables cell by cell, lines, videos, Sheets charts, groups) with size and " +
        "transform, and the speaker notes' shape id; plus layouts, masters and the page size. A shape's text is exact, so offset k is " +
        "index k for insertText and text ranges. Sizes show as \"3000000 EMU\"; requests take {magnitude, unit}. A long deck is cut at a " +
        "slide (`nextSlide`: read on with from_slide). format raw returns the API's JSON, narrowed by `fields`. Returns revisionId.",
      inputSchema: {
        account: readAccountArg(),
        presentation_id: fileIdArg("presentation"),
        slide_ids: z.array(z.string().min(1)).max(200).default([]).describe("Only these slides, by object id. Empty means every slide."),
        from_slide: z.number().int().min(0).default(0).describe("The first slide to show, by position (0-based)."),
        format: z.enum(["outline", "raw"]).default("outline"),
        fields: z.string().default("").describe('format raw only: a field mask over the Presentation, e.g. "slides(objectId,pageElements(objectId,image))".'),
        max_chars: z.number().int().min(2000).max(400_000).default(60_000),
      },
    },
    handled((args: { account: string; presentation_id: string; slide_ids: string[]; from_slide: number; format: "outline" | "raw"; fields: string; max_chars: number }) =>
      getPresentation(registry.get(args.account), {
        presentationId: args.presentation_id,
        format: args.format,
        slideIds: args.slide_ids,
        fromSlide: args.from_slide,
        fields: args.fields,
        maxChars: args.max_chars,
      }),
    ),
  );

  server.registerTool(
    "batch_update_presentation",
    {
      title: "Apply Slides API requests",
      description:
        "Any Google Slides API batchUpdate: slides (create, duplicate, reorder, delete, background), shapes, text boxes, images (by URL, " +
        "or local files through `images`), " +
        "videos, lines, tables (rows, columns, merges, cell and border styles), Sheets charts, text and its styles, bullets, " +
        "replace all text or shapes with images, transforms, z-order, alt text and the rest. One atomic batch, checked against the " +
        "API's schema before anything is sent. Ids you choose for new objects (5 to 50 characters, starting with a letter or _) can be " +
        "referred to by later requests in the same batch. expected_revision (from get_presentation) refuses the batch if the deck " +
        "changed. Returns the new revisionId and the replies that carry ids, by request position.",
      inputSchema: {
        account: writeAccountArg(),
        presentation_id: fileIdArg("presentation"),
        requests: requestsArg(SLIDES_API, '{"createSlide": {"objectId": "slide_intro", "slideLayoutReference": {"predefinedLayout": "TITLE_AND_BODY"}}}'),
        expected_revision: z.string().default("").describe("The revisionId these requests were computed from; the batch is refused if the deck is no longer at it."),
        images: imagesArg(),
      },
    },
    handled((args: { account: string; presentation_id: string; requests: Record<string, unknown>[]; expected_revision: string; images: ImageArgs }) =>
      batchUpdatePresentation(registry.get(args.account), {
        presentationId: args.presentation_id,
        requests: args.requests,
        expectedRevision: args.expected_revision,
        images: imageSources(args.images),
      }),
    ),
  );

  server.registerTool(
    "create_presentation",
    {
      title: "Create a blank deck",
      description:
        "A new, blank Google Slides deck in a Drive folder or My Drive's root, to build with batch_update_presentation. " +
        "Returns its id, link, revisionId and the object id of the title slide Slides gives every new deck.",
      inputSchema: { account: writeAccountArg(), title: z.string().min(1), ...folderArgs() },
    },
    handled((args: { account: string; title: string; folder_id: string; folder_path: string }) =>
      createPresentation(registry.get(args.account), { title: args.title, folderId: args.folder_id, folderPath: args.folder_path }),
    ),
  );
};
