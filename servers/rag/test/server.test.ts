/**
 * The server as a client sees it, through the kit's guard: an in-memory store,
 * a bag-of-words embedder and a word-overlap reranker; no database, no models.
 */
import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, idempotentWrites, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { makeQueryInference } from "../src/app/inference.js";
import type { Deps, EmbeddingModel, RemoteEmbedder, RemoteReranker, Reranker, Store } from "../src/app/ports.js";
import { asAppError, fail } from "../src/domain/errors.js";
import { NO_USAGE, PROBE_TEXTS } from "../src/domain/provider.js";
import { buildDeps, embeddingModelsFrom, localOnlyFrom, namedOnlyFrom } from "../src/composition.js";
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
    readonly localOnly?: ReadonlySet<string>;
    readonly localOnlyInvalid?: readonly string[];
    readonly namedOnly?: ReadonlySet<string>;
    readonly namedOnlyInvalid?: readonly string[];
    readonly inference?: Deps["inference"];
    readonly inferenceForOptions?: Deps["inferenceForOptions"];
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
    localOnly: over.localOnly ?? new Set(),
    localOnlyInvalid: over.localOnlyInvalid ?? [],
    namedOnly: over.namedOnly ?? new Set(),
    namedOnlyInvalid: over.namedOnlyInvalid ?? [],
    inference: over.inference,
    inferenceForOptions: over.inferenceForOptions,
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
    expect(tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name).sort()).toEqual(["expand", "health", "list_collections", "list_sources", "read_document", "search", "similar"]);
    // It reads this server's own index and nothing outside it, which the other readers (health, search) do not claim.
    expect(tools.find((t) => t.name === "similar")?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
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
  it("freezes copies, excludes them from default search and refuses mutations", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: "." });
    const snapshot = await s.call("snapshot_collections", { copies: [{ from: "docs", name: "frozen" }] });
    expect(snapshot.snapshots[0].snapshot).toBe(true);
    expect((await s.call("search", { query: "repairs" })).results.every((r: { collection: string }) => r.collection === "docs")).toBe(true);
    const before = await s.call("search", { query: "repairs", collections: ["frozen"] });
    await s.call("remove_source", { collection: "docs", path: join(s.inbox, "lease") });
    expect((await s.call("search", { query: "repairs", collections: ["frozen"] })).results).toEqual(before.results);
    expect(await s.call("index_path", { collection: "frozen", path: "." })).toMatchObject({ error: { kind: "input" } });
    expect(await s.call("remove_source", { collection: "frozen", path: join(s.inbox, "lease") })).toMatchObject({ error: { kind: "input" } });
    expect(await s.call("snapshot_collections", { copies: [{ from: "docs", name: "frozen" }] })).toMatchObject({ error: { kind: "input" } });
  });

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

  it("retrieves each phrasing in `also` as well, and reranks the merged candidates against the query", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: "." });
    const query = "Cine plătește reparațiile capitale?";
    const helped = await s.call("search", { query, also: ["Who pays for major repairs to the structure?", query], limit: 1, candidates: 2 });
    expect(helped.also).toEqual(["Who pays for major repairs to the structure?"]);
    expect(helped.results[0].source).toBe(join(s.inbox, "lease/contract.md"));
    expect((await s.call("search", { query, limit: 1 })).also).toBeUndefined();
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

  it.skipIf(process.getuid?.() === 0)("reports a file it may not open with the reason and its system code, and indexes the rest", async () => {
    const s = await connected();
    await s.call("create_collection", { name: "docs" });
    const locked = join(s.inbox, "lease/locked.md");
    await writeFile(locked, "# Locked\n\nA file whose owner did not let this server read it.");
    await chmod(locked, 0o000);
    const out = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(out).toMatchObject({ files: 4, indexed: 3, failed: 1 });
    expect(out.failed_files).toEqual([{ status: "failed", source: locked, error: expect.stringContaining("EACCES") }]);
    expect(out.failed_files[0].error).toBe(`unreadable: ${locked} cannot be opened by this server (EACCES)`);
    expect(JSON.stringify(out)).not.toContain("[object Object]");
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

describe("similar", () => {
  const PRICING = "# Pricing\n\nThe standard plan costs ten dollars per month and includes email support.\n\n## Billing\n\nAnnual billing gives two months free of charge.";
  const DRAFT = `${PRICING}\n\n## Discounts\n\nStudents and teachers receive a discount on every plan.`;
  const sections = (count: number, tag: string) =>
    Array.from({ length: count }, (_, i) => `# ${tag} ${i}\n\nSection ${i} says something about topic${i} and subject${i}.`).join("\n\n");

  const withNotes = async (files: Readonly<Record<string, string>>) => {
    const s = await connected();
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(s.inbox, path, ".."), { recursive: true });
      await writeFile(join(s.inbox, path), text);
    }
    await s.call("create_collection", { name: "docs" });
    await s.call("index_path", { collection: "docs", path: s.inbox });
    return s;
  };

  it("finds an identical copy first with score 1, then the draft that says more, and the unrelated documents after, never the source", async () => {
    const s = await withNotes({ "notes/pricing.md": PRICING, "notes/pricing-copy.md": PRICING, "notes/pricing-draft.md": DRAFT });
    const source = join(s.inbox, "notes/pricing.md");
    const found = await s.call("similar", { collection: "docs", source });
    expect(found).toMatchObject({ collection: "docs", source, chunks: 2, compared: 2, sampled: false });
    const names = found.results.map((r: { source: string }) => r.source.slice(s.inbox.length + 1));
    expect(names.slice(0, 2)).toEqual(["notes/pricing-copy.md", "notes/pricing-draft.md"]);
    expect(names).not.toContain("notes/pricing.md");
    expect(found.results[0]).toMatchObject({ score: 1, forward: 1, backward: 1, chunks: 2, sampled: false });
    const [copy, draft, ...rest] = found.results as { score: number; forward: number; backward: number; chunks: number }[];
    // The draft says everything the note says (forward 1) and one thing more, which the note does not (backward below 1).
    expect(draft).toMatchObject({ forward: 1, chunks: 3 });
    expect(draft?.backward).toBeLessThan(1);
    expect(draft?.score).toBeGreaterThan(0.8);
    expect(draft?.score).toBeLessThan(1);
    expect(rest.length).toBeGreaterThan(0);
    for (const unrelated of rest) expect(unrelated.score).toBeLessThan(draft?.score ?? 0);
    const scores = found.results.map((r: { score: number }) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(copy?.score).toBe(1);

    // The closest pair names a chunk on each side, which expand reads.
    const best = found.results[0].best;
    expect(best).toMatchObject({ value: 1, location: "Pricing", source_location: "Pricing" });
    const theirs = await s.call("expand", { collection: "docs", id: best.chunk, before: 0, after: 0 });
    const mine = await s.call("expand", { collection: "docs", id: best.source_chunk, before: 0, after: 0 });
    expect([theirs.source, mine.source]).toEqual([join(s.inbox, "notes/pricing-copy.md"), source]);
    expect(theirs.chunks[0].text).toBe(mine.chunks[0].text);
  });

  it("scores a pair the same from either side, and keeps the best `limit` at or above `min_score`", async () => {
    const s = await withNotes({ "notes/pricing.md": PRICING, "notes/pricing-copy.md": PRICING, "notes/pricing-draft.md": DRAFT });
    const forward = await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing.md") });
    const backward = await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing-draft.md") });
    const draft = forward.results.find((r: { source: string }) => r.source.endsWith("pricing-draft.md"));
    const note = backward.results.find((r: { source: string }) => r.source.endsWith("notes/pricing.md"));
    expect(draft.score).toBe(note.score);
    expect([draft.forward, draft.backward]).toEqual([note.backward, note.forward]);

    expect((await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing.md"), limit: 1 })).results).toHaveLength(1);
    const high = await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing.md"), min_score: draft.score });
    expect(high.results.map((r: { source: string }) => r.source.slice(s.inbox.length + 1))).toEqual(["notes/pricing-copy.md", "notes/pricing-draft.md"]);
    const exact = await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing.md"), min_score: 1 });
    expect(exact.results.map((r: { score: number }) => r.score)).toEqual([1]);
    // One nearest chunk per compared chunk finds at most as many documents as the source has chunks.
    expect((await s.call("similar", { collection: "docs", source: join(s.inbox, "notes/pricing.md"), candidates: 1 })).results.length).toBeLessThanOrEqual(2);
  });

  it("says when a long document was compared by a sample of its chunks", async () => {
    const s = await withNotes({ "long/one.md": sections(70, "Part"), "long/two.md": sections(70, "Part"), "long/short.md": sections(3, "Part") });
    const found = await s.call("similar", { collection: "docs", source: join(s.inbox, "long/one.md") });
    expect(found).toMatchObject({ chunks: 70, compared: 64, sampled: true });
    expect(found.results[0]).toMatchObject({ source: join(s.inbox, "long/two.md"), score: 1, chunks: 70, sampled: true });
    // The source is whole here; the long document is a result, and its entry says it was sampled.
    const short = await s.call("similar", { collection: "docs", source: join(s.inbox, "long/short.md") });
    expect(short).toMatchObject({ chunks: 3, compared: 3, sampled: false });
    expect(short.results.find((r: { source: string }) => r.source === join(s.inbox, "long/one.md"))).toMatchObject({ chunks: 70, sampled: true });
  });

  it("answers a document with no chunks with no results", async () => {
    const s = await withNotes({ "notes/pricing.md": PRICING });
    const blank = join(s.inbox, "notes/blank.md");
    await writeFile(blank, PRICING);
    await s.call("index_path", { collection: "docs", path: blank });
    await writeFile(blank, "");
    await s.call("index_path", { collection: "docs", path: blank });
    expect(await s.call("similar", { collection: "docs", source: blank })).toEqual({ collection: "docs", source: blank, chunks: 0, compared: 0, sampled: false, results: [] });
  });

  it("reports a collection that does not exist as search does, and a source that is not indexed with a hint to list_sources", async () => {
    const s = await withNotes({ "notes/pricing.md": PRICING });
    const source = join(s.inbox, "notes/pricing.md");
    const nothing = await s.call("similar", { collection: "nope", source });
    expect(nothing.error).toMatchObject({ kind: "not_found" });
    expect(nothing.error.message).toBe((await s.call("search", { query: "price", collections: ["nope"] })).error.message);
    const missing = await s.call("similar", { collection: "docs", source: "/data/notes/missing.md" });
    expect(missing.error).toMatchObject({ kind: "not_found" });
    expect(missing.error.message).toContain('"/data/notes/missing.md" is not indexed in collection "docs"');
    expect(missing.error.message).toContain("list_sources");
  });

  it("refuses a limit, a score or a number of candidates outside what the schema allows", async () => {
    const s = await withNotes({ "notes/pricing.md": PRICING });
    const source = join(s.inbox, "notes/pricing.md");
    for (const bad of [{ limit: 0 }, { limit: 51 }, { min_score: -0.1 }, { min_score: 1.1 }, { candidates: 0 }, { candidates: 51 }, { limit: 1.5 }]) {
      const result = (await s.client.callTool({ name: "similar", arguments: { collection: "docs", source, ...bad } })) as { isError?: boolean };
      expect(result.isError, JSON.stringify(bad)).toBe(true);
    }
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

/** Query inference at a remote provider that answers as the local fakes do, keeping every request it was sent. */
const remoteQueryInference = () => {
  const seen = { embed: [] as (readonly string[])[], rerank: [] as (readonly string[])[] };
  const embedder = fakeRemote({
    embed: async (texts) => {
      seen.embed.push(texts);
      return { vectors: texts.map((t) => fakeEmbed(t)), usage: NO_USAGE };
    },
  });
  const remoteReranker: RemoteReranker = {
    model: "@cf/test/rerank",
    rerank: async (query, texts) => {
      seen.rerank.push(texts);
      return { scores: texts.map((t, index) => ({ index, score: fakeRerankScore(query, t) })), usage: NO_USAGE };
    },
  };
  const localReranker: Reranker = { info: async () => ({ model: "test/rerank" }), rerank: async (query, texts) => texts.map((t, index) => ({ index, score: fakeRerankScore(query, t) })).sort((a, b) => b.score - a.score) };
  const make = (timeoutMs = 2000) => makeQueryInference({ provider: "cloudflare", remote: () => embedder, remoteReranker, localReranker, batch: 2, timeoutMs });
  return { seen, inference: make(), inferenceForOptions: (options: { readonly timeoutMs?: number | undefined }) => make(options.timeoutMs) };
};

describe("local-only collections", () => {
  const QUESTION = "Who pays for major repairs to the building structure?";

  /** A local-only "journal" and a regular "docs", both holding the same files, with a remote query provider configured. */
  const withRemote = async (over: { readonly localOnly?: ReadonlySet<string> } = {}) => {
    const remote = remoteQueryInference();
    const s = await connected({ localOnly: over.localOnly ?? new Set(["journal"]), inference: remote.inference, inferenceForOptions: remote.inferenceForOptions });
    for (const name of ["journal", "docs"]) {
      await s.call("create_collection", { name });
      await s.call("index_path", { collection: name, path: "." });
    }
    return { ...s, seen: remote.seen };
  };

  it("keeps the questions and passages of a local-only collection off the remote provider, whatever the call asks", async () => {
    const s = await withRemote();
    const asks = [{}, { reranker_model: "@cf/cloudflare/clef-flash" }, { inference_timeout_ms: 5000 }, { reranker_model: "@cf/cloudflare/clef", inference_timeout_ms: 1 }];
    for (const options of asks) {
      const found = await s.call("search", { query: QUESTION, collections: ["journal"], ...options });
      expect(found).toMatchObject({ collections: ["journal"], local_only: ["journal"], reranked: true });
      expect(found.inference).toBeUndefined();
      expect(found.results[0].text).toContain("paid by the landlord");
    }
    expect(s.seen).toEqual({ embed: [], rerank: [] });
    // A scope that mixes it with a regular collection runs entirely local, the regular one's passages included.
    const mixed = await s.call("search", { query: QUESTION, collections: ["docs", "journal"], also: ["landlord repairs"], limit: 10 });
    expect(mixed).toMatchObject({ collections: ["docs", "journal"], local_only: ["journal"], reranked: true });
    expect(new Set(mixed.results.map((r: { collection: string }) => r.collection))).toEqual(new Set(["docs", "journal"]));
    expect(mixed.inference).toBeUndefined();
    expect(s.seen).toEqual({ embed: [], rerank: [] });
    // The stubs are live: a regular collection alone does reach the remote provider.
    const regular = await s.call("search", { query: QUESTION, collections: ["docs"] });
    expect(regular.local_only).toBeUndefined();
    expect(regular.inference.map((i: { provider: string }) => i.provider)).toEqual(["cloudflare", "cloudflare"]);
    expect(s.seen.embed.length).toBeGreaterThan(0);
    expect(s.seen.rerank.length).toBeGreaterThan(0);
  });

  it("leaves local-only collections out of a search that names none, and searches them when named", async () => {
    const s = await withRemote();
    const byDefault = await s.call("search", { query: QUESTION, limit: 10 });
    expect(byDefault.collections).toEqual(["docs"]);
    expect(byDefault.local_only).toBeUndefined();
    expect(byDefault.results.every((r: { collection: string }) => r.collection === "docs")).toBe(true);
    expect((await s.call("search", { query: QUESTION, collections: [] })).collections).toEqual(["docs"]);
    expect((await s.call("search", { query: QUESTION, collections: ["journal"] })).results[0].collection).toBe("journal");
    // With nothing else to search, the default says why it found nothing.
    const only = await connected({ localOnly: new Set(["journal"]) });
    await only.call("create_collection", { name: "journal" });
    await only.call("index_path", { collection: "journal", path: "." });
    expect(await only.call("search", { query: QUESTION })).toMatchObject({ results: [], note: expect.stringContaining("RAG_LOCAL_ONLY_COLLECTIONS") });
  });

  it("refuses to embed a local-only collection at a remote provider, creating, moving or indexing it", async () => {
    const sent: string[] = [];
    const localOnly = new Set(["journal"]);
    const s = await connected({ localOnly, remote: fakeRemote({ sent }) });
    const refused = await s.call("create_collection", { name: "journal", embedding_provider: "cloudflare" });
    expect(refused.error).toMatchObject({ kind: "input" });
    expect(refused.error.message).toContain("RAG_LOCAL_ONLY_COLLECTIONS");
    expect((await s.call("list_collections")).count).toBe(0);
    expect(sent).toEqual([]);
    // Another name is not affected.
    expect(await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" })).toMatchObject({ created: true });
    // A collection made remote before its name was listed: refused until it is moved here.
    await s.call("create_collection", { name: "notes", embedding_provider: "cloudflare" });
    localOnly.add("notes");
    const probed = [...sent];
    const embeddedBefore = s.embedded.length;
    const indexed = await s.call("index_path", { collection: "notes", path: "." });
    expect(indexed.error).toMatchObject({ kind: "input" });
    expect(indexed.error.message).toContain("RAG_LOCAL_ONLY_COLLECTIONS");
    expect(await s.call("create_collection", { name: "notes" })).toMatchObject({ error: { kind: "input" } });
    expect(s.embedded.length).toBe(embeddedBefore);
    expect(await s.call("create_collection", { name: "notes", embedding_provider: "local" })).toMatchObject({ switched: { from: "cloudflare", to: "local" } });
    expect(await s.call("index_path", { collection: "notes", path: "." })).toMatchObject({ indexed: 3, embedding: { provider: "local" } });
    // Nothing but the probes of the two remote collections made before it was listed ever reached the provider.
    expect(sent).toEqual(probed);
  });

  it("refuses a snapshot of a local-only collection, whose copy would be searched remotely", async () => {
    const s = await withRemote();
    const refused = await s.call("snapshot_collections", { copies: [{ from: "journal", name: "journal-frozen" }] });
    expect(refused.error).toMatchObject({ kind: "input" });
    expect(refused.error.message).toContain("RAG_LOCAL_ONLY_COLLECTIONS");
    expect((await s.call("list_collections")).collections.map((c: { name: string }) => c.name)).toEqual(["docs", "journal"]);
    expect(await s.call("snapshot_collections", { copies: [{ from: "docs", name: "docs-frozen" }] })).toMatchObject({ snapshots: [{ name: "docs-frozen" }] });
  });

  it("changes nothing else: the other tools answer as usual, and health lists the names sorted", async () => {
    const s = await withRemote({ localOnly: new Set(["notes", "journal"]) });
    const source = join(s.inbox, "lease/contract.md");
    const found = await s.call("search", { query: QUESTION, collections: ["journal"] });
    expect((await s.call("expand", { collection: "journal", id: found.results[0].id })).chunks.length).toBeGreaterThan(0);
    expect((await s.call("read_document", { collection: "journal", source })).chunks.length).toBeGreaterThan(0);
    expect((await s.call("list_sources", { collection: "journal" })).total).toBe(3);
    expect((await s.call("similar", { collection: "journal", source })).error).toBeUndefined();
    expect((await s.call("health")).local_only_collections).toEqual(["journal", "notes"]);
  });

  it("reads a name as a collection name, lowercased, and sets aside what is not one", () => {
    const parsed = localOnlyFrom({ RAG_LOCAL_ONLY_COLLECTIONS: "Journal, notes;old, journal notes ,archive_2,notes;old" });
    expect(parsed).toEqual({ names: new Set(["journal", "archive_2"]), invalid: ["notes;old", "journal notes"] });
    expect(buildDeps({ RAG_LOCAL_ONLY_COLLECTIONS: "Journal" }).localOnly).toEqual(new Set(["journal"]));
    expect(buildDeps({ RAG_LOCAL_ONLY_COLLECTIONS: "journal;notes" }).localOnlyInvalid).toEqual(["journal;notes"]);
  });

  it("fails health on an entry that is not a collection name, and lists names that match no collection yet", async () => {
    const parsed = localOnlyFrom({ RAG_LOCAL_ONLY_COLLECTIONS: "Journal,journal;notes,journal notes,later" });
    const s = await connected({ localOnly: parsed.names, localOnlyInvalid: parsed.invalid });
    await s.call("create_collection", { name: "journal" });
    const health = await s.call("health");
    expect(health.ok).toBe(false);
    expect(health.local_only_collections).toEqual(["journal", "later"]);
    expect(health.local_only_invalid).toEqual(["journal;notes", "journal notes"]);
    expect(health.local_only_unknown).toEqual(["later"]);
    // Only the setting's own problems: the extractors' (pdftotext, pandoc and the rest) depend on the machine running the tests.
    const localOnlyProblems = (problems: readonly string[] | undefined) => (problems ?? []).filter((p) => p.startsWith("RAG_LOCAL_ONLY_COLLECTIONS"));
    expect(localOnlyProblems(health.problems)).toEqual([expect.stringContaining('RAG_LOCAL_ONLY_COLLECTIONS lists "journal;notes"'), expect.stringContaining('lists "journal notes"')]);
    // A name with no collection yet is information, not a failure: the collection is covered once it exists.
    const fine = await connected({ localOnly: new Set(["later"]) });
    const ok = await fine.call("health");
    expect(ok).toMatchObject({ local_only_collections: ["later"], local_only_unknown: ["later"] });
    expect(ok.local_only_invalid).toBeUndefined();
    expect(localOnlyProblems(ok.problems)).toEqual([]);
    await fine.call("create_collection", { name: "later" });
    expect((await fine.call("health")).local_only_unknown).toBeUndefined();
  });

  it("says which local-only collections a default search left out, when others remain", async () => {
    const s = await withRemote();
    const byDefault = await s.call("search", { query: QUESTION });
    expect(byDefault).toMatchObject({ collections: ["docs"], left_out_local_only: ["journal"] });
    expect((await s.call("search", { query: QUESTION, collections: ["docs"] })).left_out_local_only).toBeUndefined();
    expect((await s.call("search", { query: QUESTION, collections: ["journal"] })).left_out_local_only).toBeUndefined();
    const plain = await withRemote({ localOnly: new Set() });
    expect((await plain.call("search", { query: QUESTION })).left_out_local_only).toBeUndefined();
  });

  it("is off when the variable is unset or empty: every search uses the configured provider", async () => {
    const env = (value: string | undefined): NodeJS.ProcessEnv => (value === undefined ? {} : { RAG_LOCAL_ONLY_COLLECTIONS: value });
    for (const value of [undefined, "", "  ", " , ,"]) expect(localOnlyFrom(env(value))).toEqual({ names: new Set(), invalid: [] });
    expect(localOnlyFrom(env(" journal, notes ,,journal"))).toEqual({ names: new Set(["journal", "notes"]), invalid: [] });
    expect(buildDeps(env("notes,journal")).localOnly).toEqual(new Set(["journal", "notes"]));
    expect(buildDeps({}).localOnly.size).toBe(0);
    expect(buildDeps({}).localOnlyInvalid).toEqual([]);

    const s = await withRemote({ localOnly: localOnlyFrom(env("")).names });
    const found = await s.call("search", { query: QUESTION, limit: 10 });
    expect(found.collections).toEqual(["docs", "journal"]);
    expect(found.local_only).toBeUndefined();
    expect(found.inference.map((i: { provider: string }) => i.provider)).toEqual(["cloudflare", "cloudflare"]);
    expect(s.seen.embed.length).toBeGreaterThan(0);
    expect(await s.call("snapshot_collections", { copies: [{ from: "journal", name: "journal-frozen" }] })).toMatchObject({ snapshots: [{ name: "journal-frozen" }] });
    expect(await s.call("create_collection", { name: "remote", embedding_provider: "cloudflare" })).toMatchObject({ created: true });
    expect((await s.call("health")).local_only_collections).toEqual([]);
  });
});

describe("named-only collections", () => {
  const QUESTION = "Who pays for major repairs to the building structure?";

  /** A named-only "journal" and a regular "docs", both holding the same files, with a remote query provider configured. */
  const withRemote = async (over: { readonly namedOnly?: ReadonlySet<string>; readonly localOnly?: ReadonlySet<string> } = {}) => {
    const remote = remoteQueryInference();
    const s = await connected({ namedOnly: over.namedOnly ?? new Set(["journal"]), localOnly: over.localOnly ?? new Set(), inference: remote.inference, inferenceForOptions: remote.inferenceForOptions });
    for (const name of ["journal", "docs"]) {
      await s.call("create_collection", { name });
      await s.call("index_path", { collection: name, path: "." });
    }
    return { ...s, seen: remote.seen };
  };

  it("leaves them out of a search that names none and says so, and searches them when named, with the configured provider", async () => {
    const s = await withRemote();
    const byDefault = await s.call("search", { query: QUESTION, limit: 10 });
    expect(byDefault).toMatchObject({ collections: ["docs"], left_out_named_only: ["journal"] });
    expect(byDefault.left_out_local_only).toBeUndefined();
    expect(byDefault.results.every((r: { collection: string }) => r.collection === "docs")).toBe(true);
    expect((await s.call("search", { query: QUESTION, collections: [] })).collections).toEqual(["docs"]);
    // Named, it is an ordinary collection: the remote provider embeds and reranks, and nothing is reported left out.
    const named = await s.call("search", { query: QUESTION, collections: ["journal"] });
    expect(named.results[0].collection).toBe("journal");
    expect(named.local_only).toBeUndefined();
    expect(named.left_out_named_only).toBeUndefined();
    expect(named.inference.map((i: { provider: string }) => i.provider)).toEqual(["cloudflare", "cloudflare"]);
    // Indexing at a remote provider and snapshots are not refused.
    expect(await s.call("create_collection", { name: "journal-remote", embedding_provider: "cloudflare" })).toMatchObject({ created: true });
    expect(await s.call("snapshot_collections", { copies: [{ from: "journal", name: "journal-frozen" }] })).toMatchObject({ snapshots: [{ name: "journal-frozen" }] });
    // With nothing else to search, the default says why it found nothing.
    const only = await connected({ namedOnly: new Set(["journal"]) });
    await only.call("create_collection", { name: "journal" });
    await only.call("index_path", { collection: "journal", path: "." });
    expect(await only.call("search", { query: QUESTION })).toMatchObject({ results: [], left_out_named_only: ["journal"], note: expect.stringContaining("RAG_NAMED_ONLY_COLLECTIONS") });
  });

  it("reports a collection on both lists as local-only, and keeps it local", async () => {
    const s = await withRemote({ localOnly: new Set(["journal"]) });
    const byDefault = await s.call("search", { query: QUESTION });
    expect(byDefault).toMatchObject({ collections: ["docs"], left_out_local_only: ["journal"] });
    expect(byDefault.left_out_named_only).toBeUndefined();
    expect((await s.call("search", { query: QUESTION, collections: ["journal"] })).local_only).toEqual(["journal"]);
  });

  it("reads the variable like the local-only one, and health lists the names, the unknown and the invalid", async () => {
    const env = (value: string | undefined): NodeJS.ProcessEnv => (value === undefined ? {} : { RAG_NAMED_ONLY_COLLECTIONS: value });
    for (const value of [undefined, "", " , ,"]) expect(namedOnlyFrom(env(value))).toEqual({ names: new Set(), invalid: [] });
    expect(namedOnlyFrom(env("Journal, notes;old ,journal"))).toEqual({ names: new Set(["journal"]), invalid: ["notes;old"] });
    expect(buildDeps(env("notes,Journal")).namedOnly).toEqual(new Set(["journal", "notes"]));
    expect(buildDeps(env("notes,Journal")).localOnly.size).toBe(0);
    expect(buildDeps({}).namedOnlyInvalid).toEqual([]);

    const parsed = namedOnlyFrom(env("journal,later,journal;notes"));
    const s = await connected({ namedOnly: parsed.names, namedOnlyInvalid: parsed.invalid });
    await s.call("create_collection", { name: "journal" });
    const health = await s.call("health");
    expect(health.ok).toBe(false);
    expect(health).toMatchObject({ named_only_collections: ["journal", "later"], named_only_unknown: ["later"], named_only_invalid: ["journal;notes"], local_only_collections: [] });
    expect((health.problems ?? []).filter((p: string) => p.startsWith("RAG_NAMED_ONLY_COLLECTIONS"))).toEqual([expect.stringContaining('lists "journal;notes"')]);
    const plain = await connected();
    const fine = await plain.call("health");
    expect(fine.named_only_collections).toEqual([]);
    expect(fine.named_only_unknown).toBeUndefined();
    expect(fine.named_only_invalid).toBeUndefined();
  });
});

describe("token-bounded remote indexing", () => {
  it("returns a clear error for an oversized chunk before requesting or saving it", async () => {
    const sent: string[] = [];
    const remote = fakeRemote({ sent, tokenBudget: 1 });
    const s = await connected({ remote });
    await s.call("create_collection", { name: "docs", embedding_provider: "cloudflare" });
    sent.length = 0;

    const indexed = await s.call("index_path", { collection: "docs", path: s.inbox });
    expect(indexed.failed).toBeGreaterThan(0);
    expect(indexed.failed_files[0]?.error).toMatch(/chunk 1 estimates \d+ tokens, exceeding Workers AI's 1-token request budget/u);
    expect(indexed.chunks_embedded).toBe(0);
    expect(sent).toEqual([]);
    expect((await s.store.documents("docs", { limit: 20, offset: 0 })).total).toBe(0);
  });
});
