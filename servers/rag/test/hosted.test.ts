/**
 * The server with no local embedding or rerank endpoint at all: every embedding
 * and every rerank goes to Workers AI. Whole-server tests run the real
 * composition (buildDeps) over an in-memory store, with only the network
 * stubbed, so what is checked is what a deployment would do: the requests
 * Workers AI is sent, and the ones it is never sent.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeHostedModel } from "../src/app/hosted.js";
import { makeQueryInference } from "../src/app/inference.js";
import type { RemoteEmbedder, RemoteReranker } from "../src/app/ports.js";
import { buildDeps, embeddingModelsFrom } from "../src/composition.js";
import { asAppError, fail } from "../src/domain/errors.js";
import { NO_USAGE, PROBE_TEXTS } from "../src/domain/provider.js";
import { makeSources } from "../src/infra/sources.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { fakeEmbed, fakeRerankScore, memoryStore } from "./memoryStore.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
/** Only Workers AI: its account and a token, and the length of the vectors the fake answers with. */
const ENV = { RAG_CLOUDFLARE_ACCOUNT_ID: ACCOUNT, RAG_CLOUDFLARE_API_TOKEN: "test-token-not-real", RAG_EMBED_DIMENSION: "64" };

const DOCS: Readonly<Record<string, string>> = {
  "lease/contract.md":
    "# Lease\n\nThe tenant pays the rent by the fifth day of each month.\n\n## Repairs\n\nMajor repairs to the structure and the installations are paid by the landlord in full.",
  "lease/annex.txt": "The heating season starts in October. Water and heating are included in the agreed price.",
  "garden/notes.md": "# Greenhouse\n\nThe greenhouse is watered early in the morning. Mosquitoes do not survive the winter there.",
};

const QUESTION = "Who pays for major repairs to the building structure?";

type Run = { readonly model: string; readonly body: Record<string, unknown> };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** What Workers AI answers when it is spent for the day (error 4006, HTTP 429). */
const SPENT = () => json(429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }], result: null });

/**
 * Workers AI as the tests see it: bge-m3 embeds as the fake does and bills a token per word, bge-reranker-base
 * and the Clef models score by word overlap. `refuse` answers a model's requests with something else instead.
 * Every request is kept.
 */
const workersAi = (refuse: Readonly<Record<string, () => Response>> = {}) => {
  const runs: Run[] = [];
  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.cloudflare.com");
    const model = decodeURIComponent(url.pathname.split(`/accounts/${ACCOUNT}/ai/run/`)[1] ?? "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    runs.push({ model, body });
    const refusal = refuse[model];
    if (refusal !== undefined) return refusal();
    if (model === "@cf/baai/bge-m3") {
      const texts = body["text"] as string[];
      const tokens = texts.reduce((n, t) => n + t.split(/\s+/u).length, 0);
      return json(200, { success: true, result: { data: texts.map((t) => fakeEmbed(t)), shape: [texts.length, 64], meta: { cost_metric_name_1: "input_tokens", cost_metric_value_1: tokens, neurons: tokens / 1000 } } });
    }
    if (model === "@cf/baai/bge-reranker-base") {
      const contexts = body["contexts"] as { text: string }[];
      return json(200, { success: true, result: { response: contexts.map((c, id) => ({ id, score: fakeRerankScore(String(body["query"]), c.text) })) } });
    }
    // The Clef models: a score from 0 to 4 per passage, by the words it shares with the query.
    const short = model.split("/").at(-1) ?? "";
    const questions = body["questions"] as Record<string, { instructions: { passage: string } }>;
    const answers = Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, { type: "score", score: Math.round(fakeRerankScore(String((body["state"] as { query: string }).query), q.instructions.passage) * 4) }]));
    return json(200, { success: true, result: { model: short, answers, usage: { input_tokens: 40 } } });
  };
  return { runs, handler, of: (model: string) => runs.filter((r) => r.model === model) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The real composition for `env`, over an in-memory store and a folder of documents, with Workers AI stubbed. */
const running = async (over: { readonly env?: NodeJS.ProcessEnv; readonly ai?: ReturnType<typeof workersAi> } = {}) => {
  const ai = over.ai ?? workersAi();
  vi.stubGlobal("fetch", ai.handler);
  // The server logs each query's provider, model and timing to stderr; the tests read it instead of printing it.
  const logged: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { logged.push(String(chunk)); return true; });
  const inbox = await mkdtemp(join(tmpdir(), "rag-hosted-"));
  for (const [path, text] of Object.entries(DOCS)) {
    await mkdir(join(inbox, path, ".."), { recursive: true });
    await writeFile(join(inbox, path), text);
  }
  const store = memoryStore();
  const deps = { ...buildDeps({ ...ENV, ...over.env }), store, sources: makeSources([inbox], { maxBytes: 1024 * 1024 }) };
  const server = new McpServer({ name: "rag", version: "test" });
  registerAll(guard(server, { service: "rag", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, ai, store, inbox, deps, logged };
};

const failureOf = (build: () => unknown) => {
  try {
    build();
    return undefined;
  } catch (thrown) {
    return asAppError(thrown);
  }
};

describe("the model Workers AI serves alone", () => {
  const models = (env: NodeJS.ProcessEnv) => embeddingModelsFrom(env)();

  it("is built when no local endpoint is named and Workers AI is, reporting what is configured and calling nothing", async () => {
    const ai = workersAi();
    vi.stubGlobal("fetch", ai.handler);
    const [model, ...more] = models({ RAG_CLOUDFLARE_ACCOUNT_ID: ACCOUNT, RAG_CLOUDFLARE_API_TOKEN: "t" });
    expect(more).toEqual([]);
    expect(model).toMatchObject({ name: "default", remoteOnly: "cloudflare" });
    expect(model?.queryPrompt).toBeUndefined();
    // The default model has a default dimension; the identity is the provider's own name for it until told otherwise.
    expect(await model?.embedder.info()).toEqual({ model: "@cf/baai/bge-m3", dimension: 1024 });
    expect(model?.remote.cloudflare).toMatchObject({ model: "@cf/baai/bge-m3", batch: 64 });
    expect(ai.runs).toEqual([]);
  });

  it("takes its name, identity, dimension, model and batch from the settings", async () => {
    const [model] = models({ ...ENV, RAG_EMBED_NAME: "bge-m3", RAG_EMBED_IDENTITY: " BAAI/bge-m3@abc123 ", RAG_EMBED_DIMENSION: "512", RAG_CLOUDFLARE_BATCH: "10" });
    expect(model?.name).toBe("bge-m3");
    expect(await model?.embedder.info()).toEqual({ model: "BAAI/bge-m3@abc123", dimension: 512 });
    expect(model?.remote.cloudflare?.batch).toBe(10);
    const [other] = models({ ...ENV, RAG_CLOUDFLARE_MODEL: "@cf/qwen/qwen3-embedding-0.6b", RAG_EMBED_DIMENSION: "1024" });
    expect(await other?.embedder.info()).toEqual({ model: "@cf/qwen/qwen3-embedding-0.6b", dimension: 1024 });
  });

  it("needs RAG_EMBED_DIMENSION for any model but the default one, and a whole positive number", () => {
    const { RAG_EMBED_DIMENSION: _unset, ...bare } = ENV;
    expect(failureOf(() => models({ ...bare, RAG_CLOUDFLARE_MODEL: "@cf/qwen/qwen3-embedding-0.6b" }))).toMatchObject({ kind: "config", variable: "RAG_EMBED_DIMENSION" });
    for (const bad of ["0", "-3", "1.5", "1e3", "0x10", "many"]) expect(failureOf(() => models({ ...ENV, RAG_EMBED_DIMENSION: bad }))).toMatchObject({ kind: "config", variable: "RAG_EMBED_DIMENSION" });
  });

  it("is not built when a local endpoint is named: then the model is the local one", () => {
    for (const local of [{ RAG_EMBED_URL: "http://embed.example" }, { RAG_EMBED_MODELS: JSON.stringify({ other: { url: "http://embed.example" } }) }]) {
      const [model] = models({ ...ENV, ...local });
      expect(model?.remoteOnly).toBeUndefined();
    }
  });

  it("keeps today's error when nothing names an endpoint, and names the half-made Workers AI setting", () => {
    expect(failureOf(() => models({}))).toMatchObject({ kind: "config", variable: "RAG_EMBED_URL" });
    expect(failureOf(() => models({}))?.message).toContain("RAG_CLOUDFLARE_API_TOKEN_FILE");
    expect(failureOf(() => models({ RAG_CLOUDFLARE_ACCOUNT_ID: ACCOUNT }))).toMatchObject({ kind: "config", variable: "RAG_CLOUDFLARE_API_TOKEN_FILE" });
    expect(failureOf(() => models({ RAG_CLOUDFLARE_API_TOKEN_FILE: "/run/secrets/token" }))).toMatchObject({ kind: "config", variable: "RAG_CLOUDFLARE_ACCOUNT_ID" });
  });

  it("refuses local-only collections, saying why, and a query prompt that has no meaning there", () => {
    const localOnly = failureOf(() => models({ ...ENV, RAG_LOCAL_ONLY_COLLECTIONS: "journal" }));
    expect(localOnly).toMatchObject({ kind: "config", variable: "RAG_LOCAL_ONLY_COLLECTIONS" });
    expect(localOnly?.message).toContain("every embedding and every rerank goes to Workers AI");
    // An entry that is not a collection name protects nothing, and is no excuse either.
    expect(failureOf(() => models({ ...ENV, RAG_LOCAL_ONLY_COLLECTIONS: "not a name" }))).toMatchObject({ variable: "RAG_LOCAL_ONLY_COLLECTIONS" });
    expect(failureOf(() => models({ ...ENV, RAG_EMBED_QUERY_PROMPT: "query" }))).toMatchObject({ variable: "RAG_EMBED_QUERY_PROMPT" });
    expect(failureOf(() => models({ ...ENV, RAG_EMBED_NAME: "Bad Name" }))).toMatchObject({ variable: "RAG_EMBED_NAME" });
  });

  it("embeds in the provider's batches and keeps the order", async () => {
    const sent: (readonly string[])[] = [];
    const remote: RemoteEmbedder = {
      provider: "cloudflare", model: "@cf/example/embed", batch: 2, missing: async () => [],
      embed: async (texts) => { sent.push(texts); return { vectors: texts.map((t) => [t.length, 1]), usage: NO_USAGE }; },
    };
    const model = makeHostedModel({ name: "example", remote, identity: "example/embed@one", dimension: 2 });
    expect(await model.embedder.embed(["a", "bb", "ccc", "dddd", "eeeee"])).toEqual([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
    expect(sent).toEqual([["a", "bb"], ["ccc", "dddd"], ["eeeee"]]);
    expect(model.remote.cloudflare).toBe(remote);
  });
});

describe("query inference with no local endpoint", () => {
  it("defaults to Workers AI for questions and candidates, with nothing to fall back on", async () => {
    const deps = buildDeps(ENV);
    expect(deps.inference?.status()).toMatchObject({ primary: "cloudflare", fallback: "none", remote_rerank_model: "@cf/baai/bge-reranker-base" });
    expect(deps.hostedRerank).toEqual({ provider: "cloudflare", model: "@cf/baai/bge-reranker-base" });
  });

  it("fails every question and rerank naming RAG_EMBED_URL when RAG_QUERY_PROVIDER says local", async () => {
    const deps = buildDeps({ ...ENV, RAG_QUERY_PROVIDER: "local" });
    const [model] = deps.models();
    for (const attempt of [() => deps.inference!.embed(model!, ["q"], 64), () => deps.inference!.rerank("q", ["a", "b"])]) {
      const failure = await attempt().then(() => undefined, asAppError);
      expect(failure).toMatchObject({ kind: "config", variable: "RAG_EMBED_URL" });
    }
  });

  it("falls back to a local reranker only when a rerank endpoint is configured", async () => {
    expect(buildDeps({ ...ENV, RAG_RERANK_URL: "http://rerank.example" }).hostedRerank).toBeUndefined();
    expect(buildDeps({ ...ENV, RAG_RERANK_URL: "http://rerank.example" }).inference?.status()).toMatchObject({ fallback: "local" });
  });

  it("reranks at Workers AI for a local embed endpoint only when remote query inference is asked for", () => {
    const local = { RAG_EMBED_URL: "http://embed.example", RAG_CLOUDFLARE_ACCOUNT_ID: ACCOUNT, RAG_CLOUDFLARE_API_TOKEN: "t" };
    // Questions asked to stay local keep their candidate passages local as well: no rerank endpoint is an error there.
    expect(buildDeps(local).hostedRerank).toBeUndefined();
    expect(buildDeps({ ...local, RAG_QUERY_PROVIDER: "cloudflare" }).hostedRerank).toMatchObject({ provider: "cloudflare" });
    expect(buildDeps({ ...local, RAG_QUERY_PROVIDER: "cloudflare" }).inference?.status()).toMatchObject({ fallback: "local" });
    expect(buildDeps({ RAG_EMBED_URL: "http://embed.example", RAG_QUERY_PROVIDER: "cloudflare" }).hostedRerank).toBeUndefined();
  });

  const hosted = () => {
    const seen = { embed: [] as (readonly string[])[], rerank: [] as (readonly string[])[] };
    const answer = {
      embed: async (texts: readonly string[]) => ({ vectors: texts.map(() => [1, 0]), usage: NO_USAGE }),
      rerank: async (_query: string, texts: readonly string[]) => ({ scores: texts.map((_, index) => ({ index, score: 0.5 })), usage: NO_USAGE }),
    };
    const remote: RemoteEmbedder = {
      provider: "cloudflare", model: "@cf/example/embed", batch: 8, missing: async () => [],
      embed: async (texts) => { seen.embed.push(texts); return answer.embed(texts); },
    };
    const model = makeHostedModel({ name: "example", remote, identity: "example/embed@one", dimension: 2 });
    let time = 0;
    const rank: RemoteReranker = { model: "@cf/example/rerank", rerank: async (query, texts) => { seen.rerank.push(texts); return answer.rerank(query, texts); } };
    const inference = makeQueryInference({ provider: "cloudflare", remote: () => remote, remoteReranker: rank, localReranker: undefined, fallback: "none", batch: 2, timeoutMs: 2000, now: () => time });
    return { seen, answer, model, inference, advance: () => { time += 3_600_001; } };
  };

  it("never probes a model that has no local endpoint, so nothing is spent comparing the provider with itself", async () => {
    const s = hosted();
    expect((await s.inference.embed(s.model, ["question"], 2)).trace).toMatchObject({ provider: "cloudflare", model: "@cf/example/embed" });
    s.advance();
    await s.inference.embed(s.model, ["another"], 2);
    expect(s.seen.embed).toEqual([["question"], ["another"]]);
    expect(s.seen.embed.flat().some((t) => PROBE_TEXTS.includes(t))).toBe(false);
    expect(s.inference.status()).toMatchObject({ fallback: "none", probes: [] });
  });

  it("fails with the provider's own error, never a missing local endpoint", async () => {
    const s = hosted();
    const spent = { kind: "provider" as const, provider: "cloudflare", reason: "quota" as const, status: 429, message: "Workers AI's daily free allocation is spent until 00:00 UTC" };
    s.answer.embed = async () => fail(spent);
    s.answer.rerank = async () => fail({ ...spent, reason: "rate_limited" });
    const embed = await s.inference.embed(s.model, ["q"], 2).then(() => undefined, asAppError);
    expect(embed).toMatchObject({ kind: "provider", reason: "quota", status: 429 });
    expect(embed?.message).toContain("daily free allocation");
    expect(await s.inference.rerank("q", ["a", "b", "c"]).then(() => undefined, asAppError)).toMatchObject({ kind: "provider", reason: "rate_limited" });
    // Invalid vectors are the provider's too.
    s.answer.embed = async (texts) => ({ vectors: texts.map(() => [0, 0]), usage: NO_USAGE });
    expect(await s.inference.embed(s.model, ["q"], 2).then(() => undefined, asAppError)).toMatchObject({ kind: "provider", reason: "rejected" });
  });

  it("reranks in batches at the provider", async () => {
    const s = hosted();
    const out = await s.inference.rerank("q", ["a", "b", "c"]);
    expect(out.trace).toMatchObject({ provider: "cloudflare", model: "@cf/example/rerank" });
    expect(s.seen.rerank).toEqual([["a", "b"], ["c"]]);
    expect(out.scores.map((x) => x.index).sort()).toEqual([0, 1, 2]);
  });
});

describe("the whole server on Workers AI alone", () => {
  it("is healthy without calling it: the model and the reranker are described from the settings", async () => {
    const s = await running();
    const health = await s.call("health");
    expect(health.ok).toBe(true);
    expect(health.embed).toEqual({ name: "default", ok: true, model: "@cf/baai/bge-m3", dimension: 64, remote_only: "cloudflare", remote: { cloudflare: "@cf/baai/bge-m3" } });
    expect(health.rerank).toEqual({ ok: true, model: "@cf/baai/bge-reranker-base", provider: "cloudflare" });
    expect(health.providers).toEqual({ cloudflare: { configured: true } });
    expect(health.query_inference).toMatchObject({ primary: "cloudflare", fallback: "none" });
    expect(health.problems?.filter((p: string) => /^(embed|rerank|cloudflare)/u.test(p)) ?? []).toEqual([]);
    expect(s.ai.runs).toEqual([]);
  });

  it("is not healthy when a setting Workers AI needs is missing, or the reranker is not one it can run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-token-"));
    await writeFile(join(dir, "token"), "\n");
    const emptyToken = await running({ env: { RAG_CLOUDFLARE_API_TOKEN: undefined, RAG_CLOUDFLARE_API_TOKEN_FILE: join(dir, "token") } });
    const empty = await emptyToken.call("health");
    expect(empty.ok).toBe(false);
    expect(empty.problems).toContain("cloudflare: RAG_CLOUDFLARE_API_TOKEN_FILE not set, and it is the only provider here that embeds or reranks");
    const odd = await (await running({ env: { RAG_CLOUDFLARE_RERANK_MODEL: "@cf/example/unknown" } })).call("health");
    expect(odd.ok).toBe(false);
    expect(odd.problems).toEqual(expect.arrayContaining([expect.stringContaining("RAG_CLOUDFLARE_RERANK_MODEL")]));
    expect(odd.rerank).toMatchObject({ ok: false });
  });

  it("fails health and every call that embeds when a local-only collection is listed, saying why", async () => {
    const s = await running({ env: { RAG_LOCAL_ONLY_COLLECTIONS: "journal" } });
    const health = await s.call("health");
    expect(health.ok).toBe(false);
    expect(health.problems).toEqual(expect.arrayContaining([expect.stringContaining("RAG_LOCAL_ONLY_COLLECTIONS lists collections whose text must never leave this machine")]));
    const made = await s.call("create_collection", { name: "journal" });
    expect(made.error).toMatchObject({ kind: "config", variable: "RAG_LOCAL_ONLY_COLLECTIONS" });
    expect(s.ai.runs).toEqual([]);
  });

  it("makes a collection with its dimension from the settings and no call, recorded at Workers AI without a probe", async () => {
    const s = await running();
    const made = await s.call("create_collection", { name: "docs", description: "leases" });
    expect(made).toMatchObject({ created: true, embedding_model: "default", collection: { model: "@cf/baai/bge-m3", dimension: 64, provider: "cloudflare", provider_model: "@cf/baai/bge-m3" } });
    expect(made.collection.provider_probe).toBeUndefined();
    expect(s.ai.runs).toEqual([]);
    expect((await s.call("create_collection", { name: "docs", description: "leases" })).created).toBe(false);
    const local = await s.call("create_collection", { name: "more", embedding_provider: "local" });
    expect(local.error).toMatchObject({ kind: "config", variable: "RAG_EMBED_URL" });
    expect(s.ai.runs).toEqual([]);
  });

  it("refuses to make a collection at Workers AI when its settings are not all there, as it always did", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rag-token-"));
    await writeFile(join(dir, "token"), "\n");
    const s = await running({ env: { RAG_CLOUDFLARE_API_TOKEN: undefined, RAG_CLOUDFLARE_API_TOKEN_FILE: join(dir, "token") } });
    expect((await s.call("create_collection", { name: "docs" })).error).toMatchObject({ kind: "config", variable: "RAG_CLOUDFLARE_API_TOKEN_FILE" });
  });

  it("indexes and searches through Workers AI: chunks and questions embedded there, candidates scored there, nothing probed", async () => {
    const s = await running();
    await s.call("create_collection", { name: "docs" });
    const indexed = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(indexed).toMatchObject({ indexed: 3, failed: 0, embedding: { embedding_model: "default", provider: "cloudflare", model: "@cf/baai/bge-m3" } });
    expect(indexed.embedding.tokens).toBeGreaterThan(0);
    expect(indexed.embedding.neurons).toBeGreaterThan(0);
    const chunks = s.ai.of("@cf/baai/bge-m3").flatMap((r) => r.body["text"] as string[]);
    expect(chunks).toHaveLength(indexed.chunks_embedded);
    expect((await s.call("list_collections")).collections[0]).toMatchObject({ spent_tokens: indexed.embedding.tokens, chunks: indexed.chunks_embedded });

    const before = s.ai.runs.length;
    const found = await s.call("search", { query: QUESTION, limit: 3 });
    expect(found.results[0]?.source).toMatch(/contract\.md$/u);
    expect(found.reranked).toBe(true);
    expect(found.inference).toEqual([
      expect.objectContaining({ stage: "embed", provider: "cloudflare", model: "@cf/baai/bge-m3" }),
      expect.objectContaining({ stage: "rerank", provider: "cloudflare", model: "@cf/baai/bge-reranker-base" }),
    ]);
    expect(found.inference.some((t: { fallback?: unknown }) => t.fallback !== undefined)).toBe(false);
    // The question, then its candidates: no probe texts, and nothing else.
    const after = s.ai.runs.slice(before);
    expect(after.map((r) => r.model)).toEqual(["@cf/baai/bge-m3", "@cf/baai/bge-reranker-base"]);
    expect(after[0]?.body).toEqual({ text: [QUESTION] });
    expect(chunks.some((t) => PROBE_TEXTS.includes(t))).toBe(false);
    // What the server logs of the query is its provider, model and timing, never the question.
    const lines = s.logged.filter((l) => l.includes("query_inference"));
    expect(lines).toHaveLength(2);
    expect(lines.join("")).not.toContain("repairs");
  });

  it("scores candidates with a Clef decision model when one is chosen, by the setting or for one call", async () => {
    const s = await running({ env: { RAG_CLOUDFLARE_RERANK_MODEL: "@cf/cloudflare/clef-flash" } });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const found = await s.call("search", { query: QUESTION, limit: 2 });
    expect(found.inference.at(-1)).toMatchObject({ stage: "rerank", provider: "cloudflare", model: "@cf/cloudflare/clef-flash" });
    expect(found.results[0]?.source).toMatch(/contract\.md$/u);
    expect(s.ai.of("@cf/cloudflare/clef-flash")).toHaveLength(1);
    expect((await s.call("health")).rerank).toMatchObject({ ok: true, model: "@cf/cloudflare/clef-flash" });
    const other = await s.call("search", { query: QUESTION, limit: 2, reranker_model: "@cf/cloudflare/clef" });
    expect(other.inference.at(-1)).toMatchObject({ model: "@cf/cloudflare/clef" });
    expect(s.ai.of("@cf/cloudflare/clef")).toHaveLength(1);
  });

  it("searches and grows a collection a local twin of the model built, once it reports that model's identity", async () => {
    const identity = "BAAI/bge-m3@0123abc";
    const s = await running({ env: { RAG_EMBED_IDENTITY: identity } });
    // As a server with local endpoints leaves it: recorded as local, with the local endpoint's model and revision.
    await s.store.ensureSchema(64);
    await s.store.createCollection({ name: "built-locally", description: "", model: identity, dimension: 64, provider: "local", provider_model: identity });
    const same = await s.call("create_collection", { name: "built-locally" });
    expect(same).toMatchObject({ created: false, collection: { provider: "local", model: identity } });
    expect(s.ai.runs).toEqual([]);

    // Its chunks go to Workers AI whatever it records, and the report says so.
    const indexed = await s.call("index_path", { collection: "built-locally", path: s.inbox });
    expect(indexed).toMatchObject({ indexed: 3, embedding: { provider: "cloudflare", model: "@cf/baai/bge-m3" } });
    expect(indexed.embedding.tokens).toBeGreaterThan(0);
    expect(s.ai.of("@cf/baai/bge-m3").length).toBeGreaterThan(0);
    const found = await s.call("search", { query: QUESTION, collections: ["built-locally"], limit: 1 });
    expect(found.results[0]?.source).toMatch(/contract\.md$/u);

    // Recording it at Workers AI changes the record alone: nothing is embedded again, and nothing is probed.
    const runs = s.ai.runs.length;
    const moved = await s.call("create_collection", { name: "built-locally", embedding_provider: "cloudflare" });
    expect(moved).toMatchObject({ switched: { from: "local", to: "cloudflare" }, collection: { provider: "cloudflare", provider_model: "@cf/baai/bge-m3" } });
    expect(s.ai.runs.length).toBe(runs);
    expect((await s.call("create_collection", { name: "built-locally", embedding_provider: "local" })).error).toMatchObject({ kind: "config", variable: "RAG_EMBED_URL" });
  });

  it("refuses that collection, naming both identities, while the server reports another", async () => {
    const s = await running();
    await s.store.ensureSchema(64);
    await s.store.createCollection({ name: "built-locally", description: "", model: "BAAI/bge-m3@0123abc", dimension: 64, provider: "local", provider_model: "BAAI/bge-m3@0123abc" });
    for (const refused of [await s.call("search", { query: QUESTION }), await s.call("index_path", { collection: "built-locally", path: s.inbox })]) {
      expect(refused.error).toMatchObject({ kind: "mismatch" });
      expect(refused.error.message).toContain("BAAI/bge-m3@0123abc");
      expect(refused.error.message).toContain("default: @cf/baai/bge-m3");
    }
    expect(s.ai.runs).toEqual([]);
  });

  it("surfaces Workers AI's own error for a question, never a missing local endpoint", async () => {
    const ai = workersAi();
    const s = await running({ ai });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const spent = workersAi({ "@cf/baai/bge-m3": SPENT });
    vi.stubGlobal("fetch", spent.handler);
    const found = await s.call("search", { query: QUESTION });
    expect(found.error).toMatchObject({ kind: "provider", provider: "cloudflare", reason: "quota", status: 429 });
    expect(found.error.message).toContain("daily free allocation is spent");
    expect(JSON.stringify(found)).not.toContain("RAG_EMBED_URL");
    // One attempt for the question: a quota that holds until midnight is not retried, and nothing else is asked.
    expect(spent.runs.map((r) => r.model)).toEqual(["@cf/baai/bge-m3"]);
  });

  it("keeps the fused order and says why when the rerank fails, with Workers AI's error and no local rerank", async () => {
    const s = await running();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const spent = workersAi({ "@cf/baai/bge-reranker-base": SPENT });
    vi.stubGlobal("fetch", spent.handler);
    const found = await s.call("search", { query: QUESTION, limit: 3 });
    expect(found.reranked).toBe(false);
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.note).toMatch(/^the reranker failed \(.*daily free allocation is spent/u);
    expect(found.note).not.toContain("RAG_RERANK_URL");
    expect(spent.runs.map((r) => r.model)).toEqual(["@cf/baai/bge-m3", "@cf/baai/bge-reranker-base"]);
    // A search that asks for no rerank never calls it.
    const plain = await s.call("search", { query: QUESTION, rerank: false });
    expect(plain.reranked).toBe(false);
    expect(plain.note).toBeUndefined();
  });

  it("does not send a question to Workers AI when the call asks for local inference, since nothing local can answer it", async () => {
    const s = await running();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const runs = s.ai.runs.length;
    const refused = await s.call("search", { query: QUESTION, local_inference: true });
    expect(refused.error).toMatchObject({ kind: "input" });
    expect(refused.error.message).toContain("local_inference");
    expect(s.ai.runs.length).toBe(runs);
  });
});
