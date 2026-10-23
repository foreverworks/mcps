import { z } from "zod";

import { fileIdArg, folderArgs, readAccountArg, writeAccountArg } from "../../../editors/mcp/args.js";
import { readDocument } from "../../app/usecases/read.js";
import { appendToDocument, createDocument, editSection } from "../../app/usecases/write.js";
import { handled } from "../envelope.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import type { Registry } from "../../composition.js";

const tabArg = () => z.string().default("").describe("A tab other than the first: its id (t.abc) or title, from get_document. Empty means the first tab.");

const markdownArg = () =>
  z
    .string()
    .describe("Markdown: # headings, paragraphs, - and 1. lists (nested by indent), **bold**, *italic*, ~~strike~~, `code`, ``` fences, [links](url), | tables |.");

const expectedRevision = () =>
  z
    .string()
    .default("")
    .describe("The revisionId read_document returned. When given, the edit is refused if the document has changed since.");

const requiredRevision = () =>
  z
    .string()
    .min(1)
    .describe("The revisionId read_document returned for the text this replaces. The edit is refused if the document has changed since.");

export const registerDocuments: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "read_document",
    {
      title: "Read a Google Doc",
      description:
        "A Google Doc as markdown (headings, lists, tables, bold/italic/links), with an index of its sections: each " +
        "heading's stable id and path (\"Plan > Risks\"). Pass `section` (an id, a path or a unique title) to read one " +
        "section. Returns revisionId for a later edit's expected_revision. Reads the first tab unless `tab` names another; images, footnotes and the like are left out, and `notShown` counts them.",
      inputSchema: {
        account: readAccountArg(),
        document_id: fileIdArg("document"),
        section: z.string().default("").describe("A section id, path or unique heading title. Empty reads the whole document."),
        max_chars: z.number().int().min(1000).max(400_000).default(60_000),
        tab: tabArg(),
      },
    },
    handled((args: { account: string; document_id: string; section: string; max_chars: number; tab: string }) =>
      readDocument(registry.get(args.account), { documentId: args.document_id, section: args.section, maxChars: args.max_chars, tab: args.tab }),
    ),
  );

  server.registerTool(
    "edit_document_section",
    {
      title: "Replace a section of a Google Doc",
      description:
        "Replace everything under one heading (its subsections included) with markdown, keeping the heading. Read " +
        "the section with read_document first and pass its revisionId: the edit is one batch, pinned to that " +
        "revision. Headings in the new body must be deeper than the section's own. Refused when the section holds " +
        "images, footnotes or other things read_document does not show (drop_hidden: true deletes them), and for " +
        "an empty body (clear: true empties the section). Returns the document's title and the section's size " +
        "before and after, in characters of markdown.",
      inputSchema: {
        account: writeAccountArg(),
        document_id: fileIdArg("document"),
        section: z.string().min(1).describe("The section's id, path or unique heading title, from read_document."),
        markdown: markdownArg(),
        expected_revision: requiredRevision(),
        clear: z.boolean().default(false).describe("With an empty markdown: delete everything under the heading."),
        drop_hidden: z.boolean().default(false).describe("Delete the images, footnotes and the like the section holds along with its text."),
        tab: tabArg(),
      },
    },
    handled(
      (args: { account: string; document_id: string; section: string; markdown: string; expected_revision: string; clear: boolean; drop_hidden: boolean; tab: string }) =>
        editSection(registry.get(args.account), {
          documentId: args.document_id,
          section: args.section,
          markdown: args.markdown,
          expectedRevision: args.expected_revision,
          clear: args.clear,
          dropHidden: args.drop_hidden,
          tab: args.tab,
        }),
    ),
  );

  server.registerTool(
    "create_document",
    {
      title: "Create a Google Doc",
      description: "A new Google Doc from markdown, in a Drive folder or My Drive's root. Returns its id and link.",
      inputSchema: { account: writeAccountArg(), title: z.string().min(1), markdown: markdownArg().default(""), ...folderArgs() },
    },
    handled((args: { account: string; title: string; markdown: string; folder_id: string; folder_path: string }) =>
      createDocument(registry.get(args.account), {
        title: args.title,
        markdown: args.markdown,
        folderId: args.folder_id,
        folderPath: args.folder_path,
      }),
    ),
  );

  server.registerTool(
    "append_to_document",
    {
      title: "Append to a Google Doc",
      description: "Markdown added after the document's last paragraph, in one batch.",
      inputSchema: { account: writeAccountArg(), document_id: fileIdArg("document"), markdown: markdownArg(), expected_revision: expectedRevision(), tab: tabArg() },
    },
    handled((args: { account: string; document_id: string; markdown: string; expected_revision: string; tab: string }) =>
      appendToDocument(registry.get(args.account), {
        documentId: args.document_id,
        markdown: args.markdown,
        expectedRevision: args.expected_revision,
        tab: args.tab,
      }),
    ),
  );
};
