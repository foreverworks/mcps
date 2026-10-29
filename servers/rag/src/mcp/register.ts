import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { createCollection, dropCollection, listCollections } from "../app/usecases/collections.js";
import { checkHealth } from "../app/usecases/health.js";
import { indexPath, listSources, removeSource } from "../app/usecases/indexing.js";
import { expand, readDocument, search } from "../app/usecases/search.js";
import { SUPPORTED_EXTENSIONS } from "../domain/kinds.js";
import { handled } from "./envelope.js";

const collection = z.string().trim().min(1).max(63).describe("A collection's name, as list_collections shows it.");

/** The whole tool surface. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  const where = deps.sources.roots.length === 0 ? "no folder is configured yet (health says so)" : `under ${deps.sources.roots.join(" or ")}`;

  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether search and indexing can work: the database (its vector and unaccent extensions, the tables and their vector dimension, how many " +
        "collections), the embed endpoint (model, revision, dimension), the rerank endpoint (model), and the text extractors found on PATH " +
        "(pdftotext, ocrmypdf, tesseract with its languages, pandoc), plus the folders it may index from. Run this before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description: "Every collection with its description, the embedding model it was built with, and how many documents and chunks it holds.",
      inputSchema: {},
    },
    handled(() => listCollections(deps)),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create a collection",
      description:
        "Make a named collection to index documents into; it records the embedding model and dimension the server uses now, and only that model " +
        "can search or grow it later. Creating one that exists with the same description is a no-op. The first collection also creates the tables.",
      inputSchema: {
        name: z.string().trim().describe("Lowercase letters, digits, - and _, at most 63 characters."),
        description: z.string().max(500).optional().describe("What the collection holds, for whoever lists it later."),
      },
    },
    handled((a) => createCollection(deps, a)),
  );

  server.registerTool(
    "drop_collection",
    {
      title: "Drop a collection",
      description: "Delete a collection and everything indexed in it (documents, chunks, embeddings). The source files are not touched; indexing them again rebuilds it.",
      inputSchema: { name: collection },
    },
    handled((a) => dropCollection(deps, a.name)),
  );

  server.registerTool(
    "index_path",
    {
      title: "Index a file or folder",
      description:
        `Index one file or every file of a folder (${where}) into a collection. Reads ${SUPPORTED_EXTENSIONS.join(", ")}; ` +
        "PDF pages without a text layer and images are OCRed in the given language. Text is cut into chunks of about 1200 characters that never cross " +
        "a page or a heading, each with a stable id and its location; only chunks not stored already are embedded, and a file whose sha256 is " +
        "unchanged (and was read the same way) is passed over, so running it again only redoes what changed. Links are never followed. One file's failure is reported and the " +
        "rest go on. Slow: embedding runs about 1-2 chunks of that size per second on a CPU, and OCR a few seconds per page.",
      inputSchema: {
        collection,
        path: z.string().trim().min(1).describe(`A file or folder ${where}; a relative path is taken from the first. Links are refused.`),
        recursive: z.boolean().default(true).describe("Also index the folders inside a folder."),
        language: z
          .string()
          .optional()
          .describe(
            "OCR language as tesseract's codes, e.g. eng, ron, deu. Default: the server's. Give the document's one language: a pair such as ron+eng " +
              "lets the second strip the first's accents. ron also rewrites the old cedilla ş and ţ as ș and ț.",
          ),
        ocr: z.boolean().default(true).describe("OCR PDF pages that have no text layer, and images."),
        force: z.boolean().default(false).describe("Read and chunk files again even when their sha256 is unchanged (embeddings of unchanged chunks are still kept)."),
        prune: z.boolean().default(false).describe("For a folder: also remove from the index the sources under it that are no longer there (only its own files when recursive is false)."),
        max_files: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(200)
          .describe("Files read in this call; unchanged files are passed over without counting, so calling again goes on with the rest."),
      },
    },
    handled((a) => indexPath(deps, { collection: a.collection, path: a.path, recursive: a.recursive, language: a.language, ocr: a.ocr, force: a.force, prune: a.prune, maxFiles: a.max_files })),
  );

  server.registerTool(
    "remove_source",
    {
      title: "Remove a source",
      description: "Remove one indexed file, or every indexed file under a folder, from a collection's index. The files themselves are not touched.",
      inputSchema: { collection, path: z.string().trim().min(1).describe("The absolute path as list_sources shows it, or a folder above several. Not / itself: drop_collection removes everything.") },
    },
    handled((a) => removeSource(deps, a)),
  );

  server.registerTool(
    "list_sources",
    {
      title: "List indexed sources",
      description: "The files indexed in a collection: path, sha256, size, kind, pages, chunks and when, in path order, a page at a time.",
      inputSchema: {
        collection,
        prefix: z.string().optional().describe("Only sources whose path starts with this; end a folder with /."),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      },
    },
    handled((a) => listSources(deps, a)),
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Find the passages that answer a question, in any language the model reads (a Romanian question finds a Romanian passage worded " +
        "differently). Hybrid: the nearest chunks by embedding and the full-text matches of any of its words (accents ignored), fused by " +
        "reciprocal rank; then the reranker reads the best candidates against the question and decides the order. Each result has its " +
        "collection, chunk id, source path, location (page or heading), text and scores. expand reads around a hit, read_document the whole " +
        "document. Reranking is the slow part: about 0.5 s per candidate on a CPU.",
      inputSchema: {
        query: z.string().trim().min(1).max(2000).describe("The question, in full sentences: the reranker reads it as written."),
        collections: z.array(collection).max(50).optional().describe("Where to search. Default: every collection."),
        source_prefix: z.string().optional().describe("Only sources whose path starts with this; end a folder with /."),
        limit: z.number().int().min(1).max(50).default(5).describe("Results returned."),
        candidates: z.number().int().min(1).max(50).default(20).describe("Fused candidates the reranker reads; more finds more and costs time."),
        rerank: z.boolean().default(true).describe("false returns the fused order, without the reranker: fast, less precise."),
        max_chars: z.number().int().min(100).max(5000).default(1200).describe("Each result's text is cut to about this many characters."),
      },
    },
    handled((a) =>
      search(deps, { query: a.query, collections: a.collections, sourcePrefix: a.source_prefix, limit: a.limit, candidates: a.candidates, rerank: a.rerank, maxChars: a.max_chars }),
    ),
  );

  server.registerTool(
    "expand",
    {
      title: "Read around a hit",
      description: "The chunks just before and after a search result in its document, in order, the hit marked: the context a passage needs.",
      inputSchema: {
        collection,
        id: z.string().trim().min(1).describe("The chunk id from search."),
        before: z.number().int().min(0).max(20).default(1),
        after: z.number().int().min(0).max(20).default(1),
      },
    },
    handled((a) => expand(deps, a)),
  );

  server.registerTool(
    "read_document",
    {
      title: "Read an indexed document",
      description: "A document's text as indexed, chunk by chunk with each one's location, up to max_chars per call; next_from continues.",
      inputSchema: {
        collection,
        source: z.string().trim().min(1).describe("The source path, as search or list_sources shows it."),
        from: z.number().int().min(0).default(0).describe("The first chunk's ordinal."),
        max_chars: z.number().int().min(500).max(100_000).default(20_000),
      },
    },
    handled((a) => readDocument(deps, { collection: a.collection, source: a.source, from: a.from, maxChars: a.max_chars })),
  );
};
