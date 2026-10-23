import { z } from "zod";

import { fileIdArg, folderArgs, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import type { ThumbnailSize } from "../../app/ports.js";
import { getThumbnails, listLayouts, readDeck } from "../../app/usecases/read.js";
import { createDeckFromOutline, fillPlaceholders } from "../../app/usecases/write.js";
import type { Registry } from "../../composition.js";
import type { OutlineSlide } from "../../domain/outline.js";
import { handled } from "../envelope.js";

const outlineSlide = z.object({
  layout: z.string().min(1).describe('A layout name from list_layouts, e.g. "Title and body".'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.union([z.string(), z.array(z.string())]).optional().describe("Text for the body placeholder; a list is one line each."),
  notes: z.string().optional().describe("Speaker notes."),
});

type OutlineArg = z.infer<typeof outlineSlide>;

/** The outline as the use case takes it: the same fields, without the ones left out. */
const outlineOf = (slides: readonly OutlineArg[]): readonly OutlineSlide[] =>
  slides.map((s) => ({
    layout: s.layout,
    ...(s.title === undefined ? {} : { title: s.title }),
    ...(s.subtitle === undefined ? {} : { subtitle: s.subtitle }),
    ...(s.body === undefined ? {} : { body: s.body }),
    ...(s.notes === undefined ? {} : { notes: s.notes }),
  }));

export const registerDecks: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "list_layouts",
    {
      title: "List a deck's layouts",
      description: "A deck's (or template's) layouts, by name, and the placeholders each has (TITLE, SUBTITLE, BODY, ...).",
      inputSchema: { account: readAccountArg(), presentation_id: fileIdArg("presentation") },
    },
    handled((args: { account: string; presentation_id: string }) => listLayouts(registry.get(args.account), { presentationId: args.presentation_id })),
  );

  server.registerTool(
    "read_deck",
    {
      title: "Read a deck",
      description: "Every slide's layout, title, other text (tables as rows) and speaker notes, in order.",
      inputSchema: { account: readAccountArg(), presentation_id: fileIdArg("presentation") },
    },
    handled((args: { account: string; presentation_id: string }) => readDeck(registry.get(args.account), { presentationId: args.presentation_id })),
  );

  server.registerTool(
    "create_deck_from_outline",
    {
      title: "Create a deck from an outline",
      description:
        "Copy a template deck through Drive, then add one slide per outline entry from the named layout, filling its " +
        "title/subtitle/body placeholders and speaker notes, and delete the template's own slides unless kept. The " +
        "outline is checked against the template before anything is copied.",
      inputSchema: {
        account: writeAccountArg(),
        template_id: fileIdArg("template deck"),
        title: z.string().min(1).describe("The new deck's name."),
        outline: z.array(outlineSlide).min(1),
        keep_template_slides: z.boolean().default(false),
        ...folderArgs(),
      },
    },
    handled(
      (args: { account: string; template_id: string; title: string; outline: OutlineArg[]; keep_template_slides: boolean; folder_id: string; folder_path: string }) =>
        createDeckFromOutline(registry.get(args.account), {
          templateId: args.template_id,
          title: args.title,
          outline: outlineOf(args.outline),
          keepTemplateSlides: args.keep_template_slides,
          folderId: args.folder_id,
          folderPath: args.folder_path,
        }),
    ),
  );

  server.registerTool(
    "fill_placeholders",
    {
      title: "Fill {{tags}} in a deck",
      description: "Replace every {{tag}} with its value (exact case) across the deck, or only the slides named. Reports how many of each were found.",
      inputSchema: {
        account: writeAccountArg(),
        presentation_id: fileIdArg("presentation"),
        values: z.record(z.string(), z.string()).describe('Tag to text, e.g. {"client": "Acme"} fills {{client}}.'),
        slide_ids: z.array(z.string()).default([]).describe("Slide object ids (read_deck) to limit it to. Empty means every slide."),
      },
    },
    handled((args: { account: string; presentation_id: string; values: Record<string, string>; slide_ids: string[] }) =>
      fillPlaceholders(registry.get(args.account), { presentationId: args.presentation_id, values: args.values, slideIds: args.slide_ids }),
    ),
  );

  server.registerTool(
    "get_thumbnails",
    {
      title: "Slide thumbnails",
      description: "A PNG thumbnail URL per slide, rendered by Google. The URLs expire after about half an hour.",
      inputSchema: {
        account: readAccountArg(),
        presentation_id: fileIdArg("presentation"),
        size: z.enum(["SMALL", "MEDIUM", "LARGE"]).default("MEDIUM").describe("SMALL is 200px wide, MEDIUM 800px, LARGE 1600px."),
      },
    },
    handled((args: { account: string; presentation_id: string; size: ThumbnailSize }) =>
      getThumbnails(registry.get(args.account), { presentationId: args.presentation_id, size: args.size }),
    ),
  );
};
