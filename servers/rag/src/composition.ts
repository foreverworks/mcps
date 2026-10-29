import { fileRootsFrom } from "@foreverworks/mcp-kit";
import { delimiter, resolve } from "node:path";

import type { Deps } from "./app/ports.js";
import { makePool } from "./infra/database.js";
import { makeExtractor } from "./infra/extract.js";
import { makeCloudflareEmbedder } from "./infra/cloudflare.js";
import { makeEmbedder, makeReranker } from "./infra/models.js";
import { makeSources } from "./infra/sources.js";
import { makeStore } from "./infra/store.js";

/** A scanned contract runs to tens of MB; the kit's default (25 MiB) is for documents sent somewhere. */
const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * The composition root: the only module naming both a port and what
 * implements it. Nothing is opened here: the database pool, the model
 * endpoints and every extractor are reached when a tool needs them, so the
 * server starts (and lists its tools) with an empty environment.
 *
 * The folders it may index from are the kit's file roots (MCP_FILE_ROOTS, the
 * inbox a service is given) plus RAG_SOURCE_ROOTS, folders it reads in place.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => {
  const extra = (env["RAG_SOURCE_ROOTS"] ?? "")
    .split(delimiter)
    .map((r) => r.trim())
    .filter((r) => r !== "")
    .map((r) => resolve(r));
  const roots = [...new Set([...fileRootsFrom(env, process.cwd()), ...extra])];
  return {
    store: makeStore(makePool(env)),
    embedder: makeEmbedder(env),
    remote: { cloudflare: makeCloudflareEmbedder(env) },
    reranker: makeReranker(env),
    extractor: makeExtractor(),
    sources: makeSources(roots, { maxBytes: positive(env["RAG_MAX_FILE_BYTES"], DEFAULT_MAX_FILE_BYTES), script: env["MCP_FILE_SCRIPT"]?.trim() || undefined }),
    settings: {
      language: env["RAG_OCR_LANGUAGE"]?.trim() || "eng",
      embedBatch: positive(env["RAG_EMBED_BATCH"], 32),
      rerankBatch: positive(env["RAG_RERANK_BATCH"], 32),
    },
    now: () => new Date(),
  };
};
