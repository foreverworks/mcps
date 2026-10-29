#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Retrieval over your own documents, all on your machine: Postgres with pgvector for the index, an embedding and a rerank server you run. " +
  "create_collection, then index_path a file or folder (PDF with OCR for scanned pages, images, docx, odt, html, epub, Markdown, text); " +
  "search answers a question with the passages that answer it, with their source and page or heading; expand and read_document give " +
  "the context. Indexing again only redoes what changed. Start with health when anything fails.";

/**
 * MCP server for retrieval-augmented generation over local files: an index in
 * Postgres (pgvector, full text), text-embeddings-inference endpoints for
 * embeddings and reranking, and the usual extractors for text. stdio by
 * default, HTTP when MCP_HTTP_PORT is set. Nothing is written to stdout: over
 * stdio it IS the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "rag", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("rag failed to start:", error);
  process.exit(1);
});
