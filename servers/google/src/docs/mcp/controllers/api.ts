import { z } from "zod";

import { fileIdArg, type ImageArgs, imageSources, imagesArg, readAccountArg, requestsArg, writeAccountArg } from "../../../editors/mcp/args.js";
import type { Registrar } from "../../../editors/mcp/registrar.js";
import { batchUpdateDocument } from "../../app/usecases/batch.js";
import { findInDocument, getDocument } from "../../app/usecases/structure.js";
import type { Registry } from "../../composition.js";
import { DOCS_API } from "../../domain/api.js";
import { PARTS, type Part } from "../../domain/structure.js";
import { handled } from "../envelope.js";

const tabArg = () => z.string().default("").describe("A tab's id (t.0) or its title. Empty means the first tab.");

const SUGGESTIONS = (DOCS_API.schemas.Document?.properties?.suggestionsViewMode?.enum ?? []).filter((v) => v !== "SUGGESTIONS_VIEW_MODE_UNSPECIFIED");

/** Docs' full API: the structure with its indices, text found as ranges, and any batchUpdate request. */
export const registerApi: Registrar<Registry> = (server, registry) => {
  server.registerTool(
    "get_document",
    {
      title: "Read a Google Doc's structure",
      description:
        "A Google Doc's structure with the indices batch_update_document needs: every tab, and for one tab its body as " +
        "elements (paragraphs with named style, heading id, bullet, styled runs and objects such as images or footnote marks; " +
        "tables with each cell's range and content; section breaks; tables of contents), each with range [startIndex, endIndex). " +
        "A paragraph's `text` holds one U+FFFC per non-text index, so offset k of text is index range[0]+k; its newline is range[1]-1. " +
        "Styles are shown short (\"11pt\", \"#1a73e8\"); in requests write {magnitude: 11, unit: \"PT\"} and {color: {rgbColor: {red, green, blue}}} (0 to 1). " +
        "`parts` adds headers, footers, footnotes, lists, named ranges, objects (image sizes and sources) and styles (page setup, named styles); " +
        "`notShown` says what exists beyond them. A long body is cut at an element (`nextIndex`: read on with start_index). " +
        "format raw returns the API's JSON, narrowed by `fields`. Returns revisionId for expected_revision. For prose, read_document's markdown is cheaper.",
      inputSchema: {
        account: readAccountArg(),
        document_id: fileIdArg("document"),
        tab: tabArg(),
        parts: z.array(z.enum(PARTS)).min(1).default(["body"]).describe("What to include for the tab."),
        start_index: z.number().int().min(0).optional().describe("Only body elements that end after this index."),
        end_index: z.number().int().min(1).optional().describe("Only body elements that start before this index."),
        suggestions: z
          .enum(SUGGESTIONS as [string, ...string[]])
          .optional()
          .describe("How suggested edits show: inline with their ids, as if accepted, or as if rejected. Default: Docs' choice for the account's access."),
        format: z.enum(["outline", "raw"]).default("outline"),
        fields: z.string().default("").describe('format raw only: a field mask over the Document, e.g. "revisionId,tabs(tabProperties)".'),
        max_chars: z.number().int().min(2000).max(400_000).default(60_000),
      },
    },
    handled(
      (args: {
        account: string;
        document_id: string;
        tab: string;
        parts: Part[];
        start_index?: number | undefined;
        end_index?: number | undefined;
        suggestions?: string | undefined;
        format: "outline" | "raw";
        fields: string;
        max_chars: number;
      }) =>
        getDocument(registry.get(args.account), {
          documentId: args.document_id,
          tab: args.tab,
          parts: args.parts,
          ...(args.start_index === undefined ? {} : { startIndex: args.start_index }),
          ...(args.end_index === undefined ? {} : { endIndex: args.end_index }),
          suggestions: args.suggestions ?? "",
          format: args.format,
          fields: args.fields,
          maxChars: args.max_chars,
        }),
    ),
  );

  server.registerTool(
    "find_in_document",
    {
      title: "Find text in a Google Doc",
      description:
        "Every place a text appears in one tab of a Google Doc (body, headers, footers and footnotes unless segments is body), " +
        "as ranges [startIndex, endIndex) to use in batch_update_document (with tabId and, outside the body, segmentId), each with its " +
        "paragraph's range and named style. Returns the revisionId the ranges are right for. With regex, text is a JavaScript regular " +
        "expression (run under a time limit); a match never crosses a paragraph.",
      inputSchema: {
        account: readAccountArg(),
        document_id: fileIdArg("document"),
        text: z.string().min(1),
        tab: tabArg(),
        match_case: z.boolean().default(false),
        whole_word: z.boolean().default(false),
        regex: z.boolean().default(false).describe('text is a regular expression, e.g. "\\{\\{[a-z_]+\\}\\}" for placeholders.'),
        segments: z.enum(["all", "body"]).default("all"),
        max_results: z.number().int().min(1).max(2000).default(200),
      },
    },
    handled(
      (args: { account: string; document_id: string; text: string; tab: string; match_case: boolean; whole_word: boolean; regex: boolean; segments: "all" | "body"; max_results: number }) =>
        findInDocument(registry.get(args.account), {
          documentId: args.document_id,
          text: args.text,
          tab: args.tab,
          matchCase: args.match_case,
          wholeWord: args.whole_word,
          regex: args.regex,
          segments: args.segments,
          limit: args.max_results,
        }),
    ),
  );

  server.registerTool(
    "batch_update_document",
    {
      title: "Apply Docs API requests",
      description:
        "Any Google Docs API batchUpdate: text, styles, bullets, tables (insert, merge, row and column, cell style), images by URL, " +
        "headers, footers, footnotes, page and section setup, named ranges, tabs, replace all text, and the rest; local images through " +
        "`images`. One atomic batch, " +
        "checked against the API's schema before anything is sent (a wrong field is refused with the nearest right name). " +
        "Requests apply in order, each to the document as the ones before left it: work from the end of the document backwards so " +
        "earlier indices stay valid. A batch that names an index needs expected_revision (refused if the document changed) or " +
        "target_revision (Docs carries the positions over later edits), from get_document or find_in_document. In a tab other than the " +
        "first, put tabId in each location and range. Returns the new revisionId and the replies that carry ids or counts, by request position.",
      inputSchema: {
        account: writeAccountArg(),
        document_id: fileIdArg("document"),
        requests: requestsArg(DOCS_API, '{"insertText": {"location": {"index": 1}, "text": "Hello\\n"}}'),
        expected_revision: z.string().default("").describe("The revisionId these requests were computed from; the batch is refused if the document is no longer at it."),
        target_revision: z.string().default("").describe("Instead: apply as of this revisionId, with Docs moving the positions over edits made since."),
        images: imagesArg(),
      },
    },
    handled((args: { account: string; document_id: string; requests: Record<string, unknown>[]; expected_revision: string; target_revision: string; images: ImageArgs }) =>
      batchUpdateDocument(registry.get(args.account), {
        documentId: args.document_id,
        requests: args.requests,
        expectedRevision: args.expected_revision,
        targetRevision: args.target_revision,
        images: imageSources(args.images),
      }),
    ),
  );
};
