/**
 * The server as a client sees it, through the kit's guard: an in-memory store,
 * a bag-of-words embedder and a word-overlap reranker; no database, no models.
 */
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, idempotentWrites, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, EmbeddingModel, RemoteEmbedder, Reranker, Store } from "../src/app/ports.js";
import { asAppError, fail } from "../src/domain/errors.js";
import { PROBE_TEXTS } from "../src/domain/provider.js";
import { buildDeps, embeddingModelsFrom } from "../src/composition.js";
import { makeExtractor } from "../src/infra/extract.js";
import { makeSources } from "../src/infra/sources.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { fakeEmbed, fakeRerankScore, memoryStore } from "./memoryStore.js";

const DOCS: Readonly<Record<string, string>> = {
  "lease/contract.md":
    "# Lease\n\nThe tenant pays the rent by the fifth day of each month.\n\n## Repairs\n\nMajor repairs to the structure and the installations are paid by the landlord in full.",
  "lease/annex.txt": "The heating season starts in October. Water and heating are included in the agreed price.",
  "garden/notes.md": "# Greenhouse\n\nThe greenhouse is watered early in the morning. Mosquitoes do not survive the winter there.",
};

/** A remote provider that embeds as the local fake does (or not), billing a token per word and a neuron per thousand tokens. */
const fakeRemote = (over: Partial<RemoteEmbedder> & { readonly sent?: string[] } = {}): RemoteEmbedder => ({
  provider: "cloudflare",
  model: "@cf/test/embed",
  batch: 3,
  missing: async () => [],
  embed: async (texts) => {
    over.sent?.push(...texts);
    const tokens = texts.reduce((n, t) => n + t.split(/\s+/u).length, 0);
    return { vectors: texts.map((t) => fakeEmbed(t)), usage: { requests: 1, texts: texts.length, tokens, neurons: tokens / 1000 } };
  },
  ...over,
});

/**
 * A second embedding model whose vectors live in another space than the default's (its words are
 * salted), with a prompt for questions; what it was asked to embed, and with which prompt, is kept.
 */
const otherModel = (seen: { texts: string[]; prompts: (string | undefined)[] }, over: Partial<EmbeddingModel> = {}): EmbeddingModel => ({
  name: "other",
  queryPrompt: "query",
  embedder: {
    info: async () => ({ model: "test/other", revision: "r2" }),
    embed: async (texts, options) => {
      if (!(texts.length === 1 && texts[0] === "dimension") && texts !== PROBE_TEXTS) {
        seen.texts.push(...texts);
        seen.prompts.push(options?.prompt);
      }
      return texts.map((t) => fakeEmbed(t.replace(/(\p{L}+)/gu, "$1x")));
    },
  },
  remote: {},
  ...over,
});

const connected = async (
  over: {
    readonly reranker?: Reranker;
    readonly wrapStore?: (store: Store) => Store;
    readonly remote?: RemoteEmbedder;
    readonly models?: (first: EmbeddingModel) => readonly EmbeddingModel[];
  } = {},
) => {
  const inbox = await mkdtemp(join(tmpdir(), "rag-inbox-"));
  for (const [path, text] of Object.entries(DOCS)) {
    await mkdir(join(inbox, path, ".."), { recursive: true });
    await writeFile(join(inbox, path), text);
  }
  const store = memoryStore();
  const embedded: string[] = [];
  const remote = over.remote ?? fakeRemote();
  const first: EmbeddingModel = {
    name: "default",
    embedder: {
      info: async () => ({ model: "test/embed", revision: "r1" }),
      embed: async (texts) => {
        // The one-word probe that learns the dimension, and a provider's probe texts, are not indexed texts.
        if (!(texts.length === 1 && texts[0] === "dimension") && texts !== PROBE_TEXTS) embedded.push(...texts);
        return texts.map((t) => fakeEmbed(t));
      },
    },
    remote: { cloudflare: remote },
  };
  const models = over.models?.(first) ?? [first];
  const deps: Deps = {
    store: over.wrapStore === undefined ? store : over.wrapStore(store),
    models: () => models,
    providers: { cloudflare: { missing: remote.missing } },
    reranker: over.reranker ?? {
      info: async () => ({ model: "test/rerank" }),
      rerank: async (query, texts) => {
        // As text-embeddings-inference does past its --max-client-batch-size: the search must send batches.
        if (texts.length > 2) throw new Error(`batch size ${texts.length} > maximum allowed batch size 2`);
        return texts.map((t, index) => ({ index, score: fakeRerankScore(query, t) })).sort((a, b) => b.score - a.score);
      },
    },
    extractor: makeExtractor(),
    sources: makeSources([inbox], { maxBytes: 1024 * 1024 }),
    settings: { language: "eng", embedBatch: 2, rerankBatch: 2, remoteConcurrency: 2 },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  const server = new McpServer({ name: "rag", version: "test" });
  registerAll(guard(server, { service: "rag", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  return { call, client, inbox, store, embedded };
};

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const deps = buildDeps({ MCP_FILE_ROOTS: "/srv/rag/inbox", MCP_HTTP_PORT: "1" });
    const server = new McpServer({ name: "rag", version: "test" });
    registerAll(guard(server, { service: "rag", policy: POLICY, log: () => undefined }), deps);
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("rag", (s) => registerAll(s, buildDeps({})), POLICY)).not.toThrow();
    expect(tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()).toEqual(["expand", "health", "list_collections", "list_sources", "read_document", "search"]);
  });

  it("answers a tool that needs the database with a config error naming the variable, from an empty environment", async () => {
    const server = new McpServer({ name: "rag", version: "test" });
    registerAll(guard(server, { service: "rag", policy: POLICY, log: () => undefined }), buildDeps({}));
    const client = await connectInMemory(server);
    const result = (await client.callTool({ name: "list_collections", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("RAG_DATABASE_URL");
  });
});

describe("index, search, read", () => {
  it("indexes a folder, finds the passage that answers a paraphrased question first, and reads around it", async () => {
    const s = await connected();
    expect((await s.call("create_collection", { name: "docs", description: "test" })).created).toBe(true);
    const indexed = await s.call("index_path", { collection: "docs", path: "." });
    expect(indexed).toMatchObject({ files: 3, indexed: 3, failed: 0, chunks_removed: 0 });
    expect(indexed.chunks_embedded).toBeGreaterThanOrEqual(3);

    const found = await s.call("search", { query: "Who pays for major repairs to the building structure?", limit: 2 });
    expect(found.reranked).toBe(true);
    expect(found.results[0].source).toBe(join(s.inbox, "lease/contract.md"));
    expect(found.results[0].location).toBe("Lease > Repairs");
    expect(found.results[0].text).toContain("paid by the landlord");

    const around = await s.call("expand", { collection: "docs", id: found.results[0].id, before: 1, after: 1 });
    expect(around.chunks.map((c: { location: string }) => c.location)).toEqual(["Lease", "Lease > Repairs"]);
    expect(around.chunks.find((c: { hit?: boolean }) => c.hit)?.id).toBe(found.results[0].id);

    const whole = await s.call("read_document", { collection: "docs", source: join(s.inbox, "lease/contract.md") });
    expect(whole.chunks.map((c: { text: string }) => c.text).join(" ")).toContain("fifth day");

    const scoped = await s.call("search", { query: "watered in the morning", source_prefix: join(s.inbox, "lease/") });
    expect(scoped.results.every((r: { source: string }) => r.source.startsWith(join(s.inbox, "lease/")))).toBe(true);
  });

  it("re-indexes only what changed, and prunes a file that is gone", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const first = s.embedded.length;
    const again = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(again).toMatchObject({ indexed: 0, unchanged: 3 });
    expect(s.embedded.length).toBe(first);

    await writeFile(join(s.inbox, "lease/contract.md"), `${DOCS["lease/contract.md"]}\n\n## Keys\n\nThe tenant returns both keys at the end.`);
    await writeFile(join(s.inbox, "garden/notes.md"), "");
    const { rm } = await import("node:fs/promises");
    await rm(join(s.inbox, "lease/annex.txt"));
    const changed = await s.call("index_path", { collection: "docs", path: s.inbox, prune: true });
    expect(changed).toMatchObject({ files: 2, indexed: 1, skipped: 1, sources_pruned: 1 });
    expect(s.embedded.slice(first)).toEqual(["The tenant returns both keys at the end."]);
    expect(changed.chunks_kept).toBe(2);

    // The emptied file keeps its place with no chunks: nothing of it is found, and it is not read again.
    const listed = await s.call("list_sources", { collection: "docs" });
    expect(listed.sources.map((x: { source: string; chunks: number }) => [x.source, x.chunks])).toEqual([
      [join(s.inbox, "garden/notes.md"), 0],
      [join(s.inbox, "lease/contract.md"), 3],
    ]);
    expect(s.store.rows().some((r) => r.source.endsWith("garden/notes.md"))).toBe(false);
    expect(await s.call("index_path", { collection: "docs", path: s.inbox })).toMatchObject({ unchanged: 2, skipped: 0 });
    expect((await s.call("remove_source", { collection: "docs", path: join(s.inbox, "lease") })).documents_removed).toBe(1);
  });

  it("prunes only the folder's own files when not recursive, and never a dot-named path", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await writeFile(join(s.inbox, "top.md"), "# Top\n\nA file at the top of the folder, about the boiler service.");
    await mkdir(join(s.inbox, ".drafts"));
    await writeFile(join(s.inbox, ".drafts/plan.md"), "# Plan\n\nA draft indexed by its own path, about the move.");
    await s.call("index_path", { collection: "docs", path: s.inbox });
    await s.call("index_path", { collection: "docs", path: join(s.inbox, ".drafts/plan.md") });
    expect((await s.call("list_sources", { collection: "docs" })).total).toBe(5);
    const { rm } = await import("node:fs/promises");
    await rm(join(s.inbox, "top.md"));
    const pruned = await s.call("index_path", { collection: "docs", path: s.inbox, recursive: false, prune: true });
    expect(pruned).toMatchObject({ files: 0, sources_pruned: 1 });
    expect((await s.call("list_sources", { collection: "docs" })).total).toBe(4);
    expect(await s.call("index_path", { collection: "docs", path: s.inbox, prune: true })).toMatchObject({ unchanged: 3, sources_pruned: 0 });
  });

  it("goes on past max_files when called again, and counts files it does not read without stopping on them", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await writeFile(join(s.inbox, "garden/photo.heic"), "not read");
    const calls = [];
    for (let i = 0; i < 3; i += 1) calls.push(await s.call("index_path", { collection: "docs", path: s.inbox, max_files: 1 }));
    expect(calls.map((c) => [c.indexed, c.unchanged, c.more === true])).toEqual([
      [1, 0, true],
      [1, 1, true],
      [1, 2, false],
    ]);
    expect(calls[0]).toMatchObject({ files: 3, not_readable: 1 });
  });

  it("embeds again the chunks another call removed between reading and saving, so none is lost", async () => {
    let race = false;
    const s = await connected({
      wrapStore: (store) => ({
        ...store,
        chunkIds: async (collection, source) => {
          const ids = await store.chunkIds(collection, source);
          if (race) {
            race = false;
            await store.removeSources(collection, source);
          }
          return ids;
        },
      }),
    });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const contract = join(s.inbox, "lease/contract.md");
    await writeFile(contract, `${DOCS["lease/contract.md"]}\n\n## Keys\n\nThe tenant returns both keys at the end.`);
    race = true;
    const out = await s.call("index_path", { collection: "docs", path: contract });
    expect(out).toMatchObject({ indexed: 1, failed: 0 });
    expect(s.store.rows().filter((r) => r.source === contract)).toHaveLength(3);
    expect((await s.call("read_document", { collection: "docs", source: contract })).chunks).toHaveLength(3);
  });

  it("reads unchanged files again when the language changes, keeping every embedding", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox, language: "eng" });
    expect(await s.call("index_path", { collection: "docs", path: s.inbox, language: "ron" })).toMatchObject({ indexed: 3, chunks_embedded: 0, chunks_removed: 0 });
    expect(await s.call("index_path", { collection: "docs", path: s.inbox, language: "ron" })).toMatchObject({ unchanged: 3 });
  });

  it("indexes a UTF-16 text file and drops NUL characters instead of failing the call", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await writeFile(join(s.inbox, "export.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Invoice total for the boiler repair.", "utf16le")]));
    await writeFile(join(s.inbox, "nul.txt"), "Meter reading\u0000 taken in January.");
    const out = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(out).toMatchObject({ indexed: 5, failed: 0 });
    expect(s.store.rows().some((r) => r.body.includes("\u0000"))).toBe(false);
    expect((await s.call("search", { query: "boiler repair invoice", rerank: false })).results[0].source).toBe(join(s.inbox, "export.txt"));
  });

  it("removes a folder given with extra slashes, and refuses to empty the collection that way", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    expect((await s.call("remove_source", { collection: "docs", path: `${s.inbox}//lease/./` })).documents_removed).toBe(2);
    const all = await s.call("remove_source", { collection: "docs", path: "/" });
    expect(all.error.message).toContain("drop_collection");
  });

  it("leaves the index as it was when a write is repeated", async () => {
    const s = await connected();
    expect(idempotentWrites(POLICY)).toEqual(["create_collection", "index_path", "remove_source"]);
    for (let i = 0; i < 2; i += 1) {
      await s.call("create_collection", { name: "docs", description: "same" });
      await s.call("index_path", { collection: "docs", path: s.inbox });
    }
    const rows = s.store.rows().length;
    expect((await s.call("list_sources", { collection: "docs" })).total).toBe(3);
    expect((await s.call("remove_source", { collection: "docs", path: join(s.inbox, "garden") })).documents_removed).toBe(1);
    expect((await s.call("remove_source", { collection: "docs", path: join(s.inbox, "garden") })).documents_removed).toBe(0);
    expect(s.store.rows().length).toBeLessThan(rows);
  });

  it("refuses a path outside its roots and passes over links", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await symlink("/etc", join(s.inbox, "etc-link"));
    const out = await s.call("index_path", { collection: "docs", path: "/etc/hostname" });
    expect(out.error.kind).toBe("input");
    expect(out.error.message).toContain("outside the folders");
    const walked = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(walked.links_not_followed).toBe(1);
  });

  it("keeps the fused order and says why when the reranker fails", async () => {
    const s = await connected({
      reranker: { info: async () => ({ model: "x" }), rerank: async () => Promise.reject(new Error("connection refused")) },
    });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const found = await s.call("search", { query: "heating season October" });
    expect(found.reranked).toBe(false);
    expect(found.note).toContain("connection refused");
    expect(found.results[0].source).toBe(join(s.inbox, "lease/annex.txt"));
  });

  it("drops a collection with everything in it, and says what went", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const dropped = await s.call("drop_collection", { name: "docs" });
    expect(dropped).toMatchObject({ dropped: "docs", documents: 3 });
    expect((await s.call("list_collections")).count).toBe(0);
    expect(s.store.rows()).toHaveLength(0);
  });

  it("indexes a collection set to a remote provider there, reports what it cost, and still embeds questions locally", async () => {
    const sent: string[] = [];
    const s = await connected({ remote: fakeRemote({ sent }) });
    const made = await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    expect(made.collection).toMatchObject({ provider: "cloudflare", provider_model: "@cf/test/embed", model: "test/embed@r1", provider_probe: { agrees: true, min_cosine: 1, texts: PROBE_TEXTS.length } });
    const indexed = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(indexed.indexed).toBe(3);
    // Every chunk went to the provider, none to the local endpoint; batches of its size (3).
    expect(s.embedded).toEqual([]);
    expect(sent.filter((t) => !PROBE_TEXTS.includes(t))).toHaveLength(indexed.chunks_embedded);
    expect(indexed.embedding).toMatchObject({ provider: "cloudflare", model: "@cf/test/embed", texts: indexed.chunks_embedded });
    expect(indexed.embedding.tokens).toBeGreaterThan(0);
    expect(indexed.embedding.neurons).toBeCloseTo(indexed.embedding.tokens / 1000, 6);
    const listed = (await s.call("list_collections")).collections[0];
    expect(listed).toMatchObject({ spent_tokens: indexed.embedding.tokens, chunks: indexed.chunks_embedded });
    const found = await s.call("search", { query: "Who pays for major repairs to the structure?", limit: 1 });
    expect(found.results[0]?.source).toMatch(/contract\.md$/u);
    expect(s.embedded).toEqual(["Who pays for major repairs to the structure?"]);
  });

  it("refuses a remote provider that does not embed as the local endpoint, and one that is not configured", async () => {
    const odd = await connected({ remote: fakeRemote({ embed: async (texts) => ({ vectors: texts.map((t) => fakeEmbed(`${t} skew skew skew`)), usage: { requests: 1, texts: texts.length, tokens: 1, neurons: 0 } }) }) });
    const refused = await odd.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    expect(refused.error).toMatchObject({ kind: "mismatch" });
    expect(refused.error.message).toMatch(/probe cosine 0\.\d+/u);
    expect((await odd.call("list_collections")).count).toBe(0);
    const bare = await connected({ remote: fakeRemote({ missing: async () => ["RAG_CLOUDFLARE_ACCOUNT_ID", "RAG_CLOUDFLARE_API_TOKEN_FILE"] }) });
    const unset = await bare.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    expect(unset.error).toMatchObject({ kind: "config", variable: "RAG_CLOUDFLARE_ACCOUNT_ID" });
    const health = await bare.call("health");
    expect(health.providers).toEqual({ cloudflare: { configured: false, missing: ["RAG_CLOUDFLARE_ACCOUNT_ID", "RAG_CLOUDFLARE_API_TOKEN_FILE"] } });
    expect(health.embedding_models).toEqual([{ name: "default", ok: true, model: "test/embed@r1", dimension: 64, remote: { cloudflare: "@cf/test/embed" } }]);
  });

  it("moves a collection between providers without embedding again what it holds", async () => {
    const sent: string[] = [];
    const s = await connected({ remote: fakeRemote({ sent }) });
    await s.call("create_collection", { name: "docs", description: "kept" });
    const first = await s.call("index_path", { collection: "docs", path: s.inbox, max_files: 1 });
    expect(first.embedding).toEqual({ embedding_model: "default", provider: "local", model: "test/embed@r1", requests: expect.any(Number), texts: first.chunks_embedded });
    const moved = await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    expect(moved).toMatchObject({ created: false, switched: { from: "local", to: "cloudflare" }, collection: { description: "kept", provider: "cloudflare" } });
    const rest = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(rest).toMatchObject({ indexed: 2, unchanged: 1 });
    expect(sent.filter((t) => !PROBE_TEXTS.includes(t))).toHaveLength(rest.chunks_embedded);
    // Unnamed, the provider stays; named again, it goes back with no probe.
    expect((await s.call("create_collection", { name: "docs" })).collection.provider).toBe("cloudflare");
    const back = await s.call("create_collection", { name: "docs", embedding_provider: "local" });
    expect(back.collection).toMatchObject({ provider: "local", provider_model: "test/embed@r1" });
    expect(back.collection.provider_probe).toBeUndefined();
  });

  it("stops at a spent quota, keeping what was saved and what it cost", async () => {
    let calls = 0;
    const s = await connected({
      remote: fakeRemote({
        embed: async (texts) => {
          calls += 1;
          // The probe and the first file pass; then the daily allocation is gone.
          if (calls > 2) return fail({ kind: "provider", provider: "cloudflare", reason: "quota", status: 429, message: "daily free allocation spent" });
          return { vectors: texts.map((t) => fakeEmbed(t)), usage: { requests: 1, texts: texts.length, tokens: 10, neurons: 0.01 } };
        },
        batch: 50,
      }),
    });
    await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    const stopped = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(stopped.error).toMatchObject({ kind: "provider", reason: "quota" });
    const listed = (await s.call("list_collections")).collections[0];
    expect(listed).toMatchObject({ documents: 1, spent_tokens: 10, spent_neurons: 0.01 });
  });

  it("indexes several files at once at a remote provider, never more than max_files in a call", async () => {
    let inFlight = 0;
    let most = 0;
    const s = await connected({
      remote: fakeRemote({
        embed: async (texts) => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
          return { vectors: texts.map((t) => fakeEmbed(t)), usage: { requests: 1, texts: texts.length, tokens: 1, neurons: 0 } };
        },
      }),
    });
    await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    const first = await s.call("index_path", { collection: "docs", path: s.inbox, max_files: 2 });
    expect(first).toMatchObject({ indexed: 2, more: true });
    expect(most).toBe(2);
    const rest = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(rest).toMatchObject({ indexed: 1, unchanged: 2, failed: 0 });
    expect(rest.more).toBeUndefined();
  });

  it("searches with the vector half alone when the full-text half runs past its time bound", async () => {
    const s = await connected({
      wrapStore: (store) => ({ ...store, matching: async () => fail({ kind: "database", code: "57014", message: "canceling statement due to statement timeout" }) }),
    });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const found = await s.call("search", { query: "Who pays for major repairs to the structure?", limit: 1 });
    expect(found.results[0]?.source).toMatch(/contract\.md$/u);
    expect(found.note).toMatch(/full-text half ran past its time bound/u);
  });
});

describe("several embedding models", () => {
  it("keeps each collection with the model that built it, and searches each with its own", async () => {
    const seen = { texts: [] as string[], prompts: [] as (string | undefined)[] };
    const s = await connected({ models: (first) => [first, otherModel(seen)] });
    expect((await s.call("create_collection", { name: "docs" })).embedding_model).toBe("default");
    const made = await s.call("create_collection", { name: "salted", embedding_model: "other" });
    expect(made).toMatchObject({ created: true, embedding_model: "other", collection: { model: "test/other@r2", provider: "local" } });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    const before = s.embedded.length;
    const salted = await s.call("index_path", { collection: "salted", path: s.inbox });
    expect(salted.embedding).toMatchObject({ embedding_model: "other", model: "test/other@r2" });
    // The second collection's chunks went to its model alone, and documents get no prompt.
    expect(s.embedded.length).toBe(before);
    expect(seen.texts).toHaveLength(salted.chunks_embedded);
    expect(seen.prompts.every((p) => p === undefined)).toBe(true);

    seen.texts.length = 0;
    seen.prompts.length = 0;
    const question = "Who pays for major repairs to the structure?";
    const found = await s.call("search", { query: question, limit: 4 });
    expect(found.embedding_models).toEqual([
      { name: "default", collections: ["docs"] },
      { name: "other", collections: ["salted"] },
    ]);
    // Once per model, the second with its prompt; each collection's best answer is found by its own model.
    expect(s.embedded.slice(before)).toEqual([question]);
    expect([seen.texts, seen.prompts]).toEqual([[question], ["query"]]);
    const firstOf = (collection: string) => found.results.find((r: { collection: string }) => r.collection === collection);
    expect(firstOf("docs")?.source).toMatch(/contract\.md$/u);
    expect(firstOf("salted")?.source).toMatch(/contract\.md$/u);
    expect(firstOf("salted")?.scores.vector_rank).toBe(1);
    // A search of one collection embeds the question with its model alone.
    const embeddedBefore = s.embedded.length;
    expect((await s.call("search", { query: question, collections: ["salted"], limit: 1 })).results[0].source).toMatch(/contract\.md$/u);
    expect([s.embedded.length, seen.texts.length]).toEqual([embeddedBefore, 2]);
  });

  it("refuses to change a collection's model, an unknown model, and a remote provider a model has no counterpart at", async () => {
    const s = await connected({ models: (first) => [first, otherModel({ texts: [], prompts: [] })] });
    await s.call("create_collection", { name: "docs" });
    const moved = await s.call("create_collection", { name: "docs", embedding_model: "other" });
    expect(moved.error).toMatchObject({ kind: "input" });
    expect(moved.error.message).toContain("a collection keeps its model");
    expect((await s.call("create_collection", { name: "docs", embedding_model: "default" })).created).toBe(false);
    const unknown = await s.call("create_collection", { name: "more", embedding_model: "nope" });
    expect(unknown.error.message).toContain("default, other");
    const remote = await s.call("create_collection", { name: "more", embedding_model: "other", embedding_provider: "cloudflare" });
    expect(remote.error).toMatchObject({ kind: "config", variable: "RAG_EMBED_MODELS" });
  });

  it("refuses a collection no endpoint serves the model of any more, naming what they serve", async () => {
    let revision = "r1";
    const s = await connected({ models: (first) => [{ ...first, embedder: { ...first.embedder, info: async () => ({ model: "test/embed", revision }) } }] });
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    revision = "r9";
    const found = await s.call("search", { query: "heating season" });
    expect(found.error).toMatchObject({ kind: "mismatch" });
    expect(found.error.message).toContain("default: test/embed@r9");
    expect((await s.call("index_path", { collection: "docs", path: s.inbox, force: true })).error).toMatchObject({ kind: "mismatch" });
  });

  it("lists every model in health, the default first, and fails health when one does not answer", async () => {
    const s = await connected({
      models: (first) => [first, otherModel({ texts: [], prompts: [] }, { embedder: { info: async () => fail({ kind: "model", endpoint: "embed", message: "http://x did not answer" }), embed: async () => [] } })],
    });
    const health = await s.call("health");
    expect(health.ok).toBe(false);
    expect(health.embed).toMatchObject({ name: "default", ok: true, model: "test/embed@r1" });
    expect(health.embedding_models[1]).toMatchObject({ name: "other", ok: false, query_prompt: "query", remote: {} });
    // Only the models' problems: the host's own tools (pdftotext, ocrmypdf...) may be missing too, as on CI's runners.
    expect(health.problems.filter((p: string) => p.startsWith("embed"))).toEqual([expect.stringContaining("embed (other): model: http://x did not answer")]);
  });
});

describe("embedding settings", () => {
  const names = (env: NodeJS.ProcessEnv) => embeddingModelsFrom(env)().map((m) => [m.name, m.queryPrompt, m.remote.cloudflare?.model, m.remote.cloudflare?.batch]);
  const failure = (env: NodeJS.ProcessEnv) => {
    try {
      embeddingModelsFrom(env)();
      return undefined;
    } catch (thrown) {
      return asAppError(thrown);
    }
  };

  it("takes RAG_EMBED_URL as the default and RAG_EMBED_MODELS as more models by name", () => {
    expect(names({ RAG_EMBED_URL: "http://a" })).toEqual([["default", undefined, "@cf/baai/bge-m3", 64]]);
    const more = JSON.stringify({ "qwen3-0.6b": { url: "http://b", query_prompt: "query", cloudflare_model: "@cf/qwen/qwen3-embedding-0.6b", cloudflare_batch: 32 }, plain: { url: "http://c" } });
    expect(names({ RAG_EMBED_URL: "http://a", RAG_EMBED_NAME: "bge-m3", RAG_EMBED_QUERY_PROMPT: "q", RAG_CLOUDFLARE_BATCH: "50", RAG_EMBED_MODELS: more })).toEqual([
      ["bge-m3", "q", "@cf/baai/bge-m3", 50],
      ["qwen3-0.6b", "query", "@cf/qwen/qwen3-embedding-0.6b", 32],
      ["plain", undefined, undefined, undefined],
    ]);
    // Without RAG_EMBED_URL the first named model is the default.
    expect(names({ RAG_EMBED_MODELS: more })[0]?.[0]).toBe("qwen3-0.6b");
  });

  it("answers a configuration error naming the setting that cannot be read", () => {
    expect(failure({})).toMatchObject({ kind: "config", variable: "RAG_EMBED_URL" });
    expect(failure({ RAG_EMBED_URL: "http://a", RAG_EMBED_MODELS: "{not json" })).toMatchObject({ kind: "config", variable: "RAG_EMBED_MODELS" });
    expect(failure({ RAG_EMBED_MODELS: JSON.stringify({ Big: { url: "http://b" } }) })?.message).toContain("lowercase");
    expect(failure({ RAG_EMBED_MODELS: JSON.stringify({ b: { url: "http://b", prefix: "x" } }) })).toMatchObject({ variable: "RAG_EMBED_MODELS" });
    expect(failure({ RAG_EMBED_URL: "http://a", RAG_EMBED_MODELS: JSON.stringify({ default: { url: "http://b" } }) })?.message).toContain("RAG_EMBED_NAME");
    expect(failure({ RAG_EMBED_URL: "http://a", RAG_EMBED_NAME: "Bad Name" })).toMatchObject({ variable: "RAG_EMBED_NAME" });
  });
});
