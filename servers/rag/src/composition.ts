import { fileRootsFrom } from "@foreverworks/mcp-kit";
import { delimiter, resolve } from "node:path";
import { z } from "zod";

import type { Deps, EmbeddingModel, QueryInference } from "./app/ports.js";
import { makeQueryInference } from "./app/inference.js";
import { COLLECTION_NAME } from "./app/usecases/collections.js";
import { configError, fail } from "./domain/errors.js";
import { makePool } from "./infra/database.js";
import { makeExtractor } from "./infra/extract.js";
import { makeCloudflareEmbedder, makeCloudflareReranker } from "./infra/cloudflare.js";
import { makeEmbedder, makeReranker } from "./infra/models.js";
import { makeSources } from "./infra/sources.js";
import { makeStore } from "./infra/store.js";

/** A scanned contract runs to tens of MB; the kit's default (25 MiB) is for documents sent somewhere. */
const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;

const positive = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw?.trim());
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/u;

/** RAG_EMBED_MODELS: more embedding models, by name, each with its own endpoint. */
const MoreModels = z.record(
  z.string(),
  z
    .object({
      url: z.string().trim().min(1),
      query_prompt: z.string().trim().min(1).optional(),
      cloudflare_model: z.string().trim().min(1).optional(),
      cloudflare_batch: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
);

/**
 * The embedding models, the default first. RAG_EMBED_URL (with
 * RAG_EMBED_QUERY_PROMPT, RAG_CLOUDFLARE_MODEL and RAG_CLOUDFLARE_BATCH) is
 * the default, named by RAG_EMBED_NAME; RAG_EMBED_MODELS adds models by name,
 * and its first is the default when RAG_EMBED_URL is unset. A setting that
 * cannot be read fails every call that embeds, naming it, and nothing else.
 */
export const embeddingModelsFrom = (env: NodeJS.ProcessEnv): (() => readonly EmbeddingModel[]) => {
  const url = env["RAG_EMBED_URL"]?.trim();
  const raw = env["RAG_EMBED_MODELS"]?.trim();
  const models: EmbeddingModel[] = [];
  if (url) {
    const name = env["RAG_EMBED_NAME"]?.trim() || "default";
    if (!MODEL_NAME.test(name)) return () => fail(configError(`RAG_EMBED_NAME "${name}" is not a model name: lowercase letters, digits, '.', '-' and '_'`, "RAG_EMBED_NAME"));
    const prompt = env["RAG_EMBED_QUERY_PROMPT"]?.trim();
    models.push({ name, embedder: makeEmbedder({ url, variable: "RAG_EMBED_URL" }), ...(prompt ? { queryPrompt: prompt } : {}), remote: { cloudflare: makeCloudflareEmbedder(env) } });
  }
  if (raw) {
    let parsed: z.infer<typeof MoreModels>;
    try {
      parsed = MoreModels.parse(JSON.parse(raw));
    } catch (thrown) {
      const why = thrown instanceof z.ZodError ? thrown.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "it is not JSON";
      return () => fail(configError(`RAG_EMBED_MODELS cannot be read (${why}): a JSON object of models by name, each {"url", "query_prompt"?, "cloudflare_model"?, "cloudflare_batch"?}`, "RAG_EMBED_MODELS"));
    }
    for (const [name, m] of Object.entries(parsed)) {
      if (!MODEL_NAME.test(name)) return () => fail(configError(`RAG_EMBED_MODELS names "${name}", which is not a model name: lowercase letters, digits, '.', '-' and '_'`, "RAG_EMBED_MODELS"));
      if (models.some((x) => x.name === name)) return () => fail(configError(`RAG_EMBED_MODELS names "${name}", which is the RAG_EMBED_URL model's name (RAG_EMBED_NAME)`, "RAG_EMBED_MODELS"));
      models.push({
        name,
        embedder: makeEmbedder({ url: m.url, variable: "RAG_EMBED_MODELS" }),
        ...(m.query_prompt === undefined ? {} : { queryPrompt: m.query_prompt }),
        // Only a model given its Workers AI counterpart can be indexed there.
        remote: m.cloudflare_model === undefined ? {} : { cloudflare: makeCloudflareEmbedder(env, { model: m.cloudflare_model, batch: m.cloudflare_batch }) },
      });
    }
  }
  if (models.length === 0) return () => fail(configError("RAG_EMBED_URL is not set: the base URL of the embed server", "RAG_EMBED_URL"));
  return () => models;
};

/**
 * RAG_LOCAL_ONLY_COLLECTIONS: collection names separated by commas, spaces
 * around them and empty entries ignored, each lowercased as collection names
 * are. An entry that is not a collection name (a typo, a space or a semicolon
 * inside it) protects nothing, so it is set aside as written for health to
 * report rather than silently dropped.
 */
export const localOnlyFrom = (env: NodeJS.ProcessEnv): { readonly names: ReadonlySet<string>; readonly invalid: readonly string[] } => {
  const entries = (env["RAG_LOCAL_ONLY_COLLECTIONS"] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  const valid = (entry: string) => COLLECTION_NAME.test(entry.toLowerCase());
  return {
    names: new Set(entries.filter(valid).map((entry) => entry.toLowerCase())),
    invalid: [...new Set(entries.filter((entry) => !valid(entry)))],
  };
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
  const reranker = makeReranker({ url: env["RAG_RERANK_URL"], variable: "RAG_RERANK_URL" });
  const provider = env["RAG_QUERY_PROVIDER"]?.trim() || "local";
  const timeoutMs = positive(env["RAG_QUERY_TIMEOUT_MS"], 2000);
  type QueryOptions = { readonly timeoutMs?: number | undefined; readonly rerankModel?: string | undefined };
  const makeInference = ({ timeoutMs: deadline = timeoutMs, rerankModel }: QueryOptions) => makeQueryInference({
    provider: provider === "cloudflare" ? "cloudflare" : "local",
    remote: (model) => model.remote.cloudflare === undefined ? undefined : makeCloudflareEmbedder(env, { attempts: 1, timeoutMs: deadline, model: model.remote.cloudflare.model, batch: model.remote.cloudflare.batch }),
    remoteReranker: makeCloudflareReranker(env, { attempts: 1, timeoutMs: deadline, ...(rerankModel === undefined ? {} : { model: rerankModel }) }),
    localReranker: reranker,
    batch: positive(env["RAG_RERANK_BATCH"], 32), timeoutMs: deadline,
    observe: (trace) => { if (provider === "cloudflare") process.stderr.write(`${JSON.stringify({ event: "query_inference", ...trace })}\n`); },
  });
  // Repeated per-call comparisons share successful probes, just as the default provider does.
  // A bounded set of option combinations keeps arbitrary deadline values from retaining state forever.
  const inferences = new Map<string, QueryInference>();
  const inferenceForOptions = (options: QueryOptions): QueryInference => {
    const key = JSON.stringify([options.timeoutMs ?? timeoutMs, options.rerankModel ?? "default"]);
    const existing = inferences.get(key);
    if (existing !== undefined) return existing;
    const made = makeInference(options);
    inferences.set(key, made);
    if (inferences.size > 16) inferences.delete(inferences.keys().next().value ?? "");
    return made;
  };
  const inference = inferenceForOptions({});
  const localOnly = localOnlyFrom(env);
  return {
    inferenceForOptions,
    inference: provider === "local" || provider === "cloudflare" ? inference : {
      ...inference,
      embed: async () => fail(configError("RAG_QUERY_PROVIDER must be local or cloudflare", "RAG_QUERY_PROVIDER")),
      rerank: async () => fail(configError("RAG_QUERY_PROVIDER must be local or cloudflare", "RAG_QUERY_PROVIDER")),
    },
    localOnly: localOnly.names,
    localOnlyInvalid: localOnly.invalid,
    store: makeStore(makePool(env)),
    models: embeddingModelsFrom(env),
    providers: { cloudflare: { missing: makeCloudflareEmbedder(env).missing } },
    reranker,
    extractor: makeExtractor(),
    sources: makeSources(roots, { maxBytes: positive(env["RAG_MAX_FILE_BYTES"], DEFAULT_MAX_FILE_BYTES), script: env["MCP_FILE_SCRIPT"]?.trim() || undefined }),
    settings: {
      language: env["RAG_OCR_LANGUAGE"]?.trim() || "eng",
      embedBatch: positive(env["RAG_EMBED_BATCH"], 32),
      rerankBatch: positive(env["RAG_RERANK_BATCH"], 32),
      remoteConcurrency: positive(env["RAG_REMOTE_CONCURRENCY"], 8),
    },
    now: () => new Date(),
  };
};
