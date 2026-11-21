import { fileRootsFrom } from "@foreverworks/mcp-kit";
import { delimiter, resolve } from "node:path";
import { z } from "zod";

import type { Deps, EmbeddingModel, QueryInference } from "./app/ports.js";
import { makeHostedModel } from "./app/hosted.js";
import { makeQueryInference } from "./app/inference.js";
import { COLLECTION_NAME } from "./app/usecases/collections.js";
import { configError, fail } from "./domain/errors.js";
import { makePool } from "./infra/database.js";
import { makeExtractor } from "./infra/extract.js";
import { cloudflareUnset, DEFAULT_MODEL, makeCloudflareEmbedder, makeCloudflareReranker } from "./infra/cloudflare.js";
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
 * Whether every embedding goes to Workers AI, because no local endpoint is
 * configured (neither RAG_EMBED_URL nor RAG_EMBED_MODELS) and Workers AI is
 * (the account and the API token are named). Decided from the environment
 * alone, at startup: nothing is called.
 */
export const embedsAtWorkersAlone = (env: NodeJS.ProcessEnv): boolean =>
  !env["RAG_EMBED_URL"]?.trim() && !env["RAG_EMBED_MODELS"]?.trim() && cloudflareUnset(env).length === 0;

/** The vector length of the model Workers AI serves by default, which needs no RAG_EMBED_DIMENSION. */
const DEFAULT_DIMENSION = 1024;

/**
 * The one embedding model of a server with no local endpoint: Workers AI's
 * (RAG_CLOUDFLARE_MODEL), reporting the identity and the dimension configured
 * instead of asking the provider, so describing it and health spend nothing.
 * Everything that would contradict "nothing here embeds locally" is a
 * configuration error, naming the variable, on every call that embeds.
 */
const workersModelFrom = (env: NodeJS.ProcessEnv): (() => readonly EmbeddingModel[]) => {
  const name = env["RAG_EMBED_NAME"]?.trim() || "default";
  if (!MODEL_NAME.test(name)) return () => fail(configError(`RAG_EMBED_NAME "${name}" is not a model name: lowercase letters, digits, '.', '-' and '_'`, "RAG_EMBED_NAME"));
  if (env["RAG_EMBED_QUERY_PROMPT"]?.trim())
    return () => fail(configError("RAG_EMBED_QUERY_PROMPT names a prompt of a local model, which has no meaning at Workers AI: unset it, or set RAG_EMBED_URL", "RAG_EMBED_QUERY_PROMPT"));
  const localOnly = localOnlyFrom(env);
  if (localOnly.names.size + localOnly.invalid.length > 0)
    return () => fail(configError("RAG_LOCAL_ONLY_COLLECTIONS lists collections whose text must never leave this machine, and with no RAG_EMBED_URL every embedding and every rerank goes to Workers AI: unset it, or set RAG_EMBED_URL and RAG_RERANK_URL", "RAG_LOCAL_ONLY_COLLECTIONS"));
  const remote = makeCloudflareEmbedder(env);
  const rawDimension = env["RAG_EMBED_DIMENSION"]?.trim();
  const dimension = rawDimension ? (/^[1-9]\d*$/u.test(rawDimension) ? Number(rawDimension) : undefined) : remote.model === DEFAULT_MODEL ? DEFAULT_DIMENSION : undefined;
  if (dimension === undefined)
    return () => fail(configError(rawDimension ? `RAG_EMBED_DIMENSION "${rawDimension}" is not a positive whole number: the length of the vectors ${remote.model} makes` : `RAG_EMBED_DIMENSION is not set: the length of the vectors ${remote.model} makes (only ${DEFAULT_MODEL}, ${DEFAULT_DIMENSION}, has a default)`, "RAG_EMBED_DIMENSION"));
  // What a collection built by a local twin of this model recorded, or else the provider's own name for it.
  const identity = env["RAG_EMBED_IDENTITY"]?.trim() || remote.model;
  const models = [makeHostedModel({ name, remote, identity, dimension })];
  return () => models;
};

/**
 * The embedding models, the default first. RAG_EMBED_URL (with
 * RAG_EMBED_QUERY_PROMPT, RAG_CLOUDFLARE_MODEL and RAG_CLOUDFLARE_BATCH) is
 * the default, named by RAG_EMBED_NAME; RAG_EMBED_MODELS adds models by name,
 * and its first is the default when RAG_EMBED_URL is unset. With neither, and
 * Workers AI configured, the one model is Workers AI's alone. A setting that
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
  if (models.length === 0) {
    const unset = cloudflareUnset(env);
    if (unset.length === 0) return workersModelFrom(env);
    const alone = "to embed at Workers AI alone, name RAG_CLOUDFLARE_ACCOUNT_ID and RAG_CLOUDFLARE_API_TOKEN_FILE";
    // Neither is set: the usual mistake is the missing endpoint. One of them: the half-made Workers AI setting.
    const [first = "RAG_EMBED_URL"] = unset;
    return unset.length === 2
      ? () => fail(configError(`RAG_EMBED_URL is not set: the base URL of the embed server (${alone})`, "RAG_EMBED_URL"))
      : () => fail(configError(`RAG_EMBED_URL is not set: the base URL of the embed server; ${alone}, and ${first} is missing`, first));
  }
  return () => models;
};

/**
 * A list of collection names in one variable: separated by commas, spaces
 * around them and empty entries ignored, each lowercased as collection names
 * are. An entry that is not a collection name (a typo, a space or a semicolon
 * inside it) matches nothing, so it is set aside as written for health to
 * report rather than silently dropped.
 */
const collectionNamesFrom = (env: NodeJS.ProcessEnv, variable: string): { readonly names: ReadonlySet<string>; readonly invalid: readonly string[] } => {
  const entries = (env[variable] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  const valid = (entry: string) => COLLECTION_NAME.test(entry.toLowerCase());
  return {
    names: new Set(entries.filter(valid).map((entry) => entry.toLowerCase())),
    invalid: [...new Set(entries.filter((entry) => !valid(entry)))],
  };
};

/** RAG_LOCAL_ONLY_COLLECTIONS: collections whose questions and passages never leave the machine. */
export const localOnlyFrom = (env: NodeJS.ProcessEnv) => collectionNamesFrom(env, "RAG_LOCAL_ONLY_COLLECTIONS");

/** RAG_NAMED_ONLY_COLLECTIONS: collections a search reads only when it names them. */
export const namedOnlyFrom = (env: NodeJS.ProcessEnv) => collectionNamesFrom(env, "RAG_NAMED_ONLY_COLLECTIONS");

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
  // With no local embedding endpoint a question can only be embedded at Workers AI, so that is the default.
  const atWorkersAlone = embedsAtWorkersAlone(env);
  const provider = env["RAG_QUERY_PROVIDER"]?.trim() || (atWorkersAlone ? "cloudflare" : "local");
  const timeoutMs = positive(env["RAG_QUERY_TIMEOUT_MS"], 2000);
  // No local rerank endpoint and remote query inference asked for: candidates are scored at Workers AI alone.
  const hostedRerank = !env["RAG_RERANK_URL"]?.trim() && provider === "cloudflare" && cloudflareUnset(env).length === 0;
  type QueryOptions = { readonly timeoutMs?: number | undefined; readonly rerankModel?: string | undefined };
  const makeInference = ({ timeoutMs: deadline = timeoutMs, rerankModel }: QueryOptions) => makeQueryInference({
    provider: provider === "cloudflare" ? "cloudflare" : "local",
    remote: (model) => model.remote.cloudflare === undefined ? undefined : makeCloudflareEmbedder(env, { attempts: 1, timeoutMs: deadline, model: model.remote.cloudflare.model, batch: model.remote.cloudflare.batch }),
    remoteReranker: makeCloudflareReranker(env, { attempts: 1, timeoutMs: deadline, ...(rerankModel === undefined ? {} : { model: rerankModel }) }),
    // Nothing to fall back on when there is no local endpoint: Workers AI's own error is the answer.
    localReranker: hostedRerank ? undefined : reranker,
    fallback: atWorkersAlone && hostedRerank ? "none" : "local",
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
  // A provider the server cannot honour answers every question and rerank with the reason, naming the setting.
  const refusal =
    provider !== "local" && provider !== "cloudflare"
      ? configError("RAG_QUERY_PROVIDER must be local or cloudflare", "RAG_QUERY_PROVIDER")
      : provider === "local" && atWorkersAlone
        ? configError("RAG_QUERY_PROVIDER=local needs a local embedding endpoint, and RAG_EMBED_URL is not set: unset RAG_QUERY_PROVIDER (it defaults to cloudflare here) or set RAG_EMBED_URL", "RAG_EMBED_URL")
        : undefined;
  const localOnly = localOnlyFrom(env);
  const namedOnly = namedOnlyFrom(env);
  return {
    inferenceForOptions,
    inference: refusal === undefined ? inference : {
      ...inference,
      embed: async () => fail(refusal),
      rerank: async () => fail(refusal),
    },
    localOnly: localOnly.names,
    localOnlyInvalid: localOnly.invalid,
    namedOnly: namedOnly.names,
    namedOnlyInvalid: namedOnly.invalid,
    store: makeStore(makePool(env)),
    models: embeddingModelsFrom(env),
    providers: { cloudflare: { missing: makeCloudflareEmbedder(env).missing } },
    reranker,
    ...(hostedRerank ? { hostedRerank: { provider: "cloudflare" as const, model: makeCloudflareReranker(env).model } } : {}),
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
