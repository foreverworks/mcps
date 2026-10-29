/**
 * The server as a client sees it, through the kit's guard: an in-memory store,
 * a bag-of-words embedder and a word-overlap reranker; no database, no models.
 */
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, idempotentWrites, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, Reranker, Store } from "../src/app/ports.js";
import { buildDeps } from "../src/composition.js";
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

const connected = async (over: { readonly reranker?: Reranker; readonly wrapStore?: (store: Store) => Store } = {}) => {
  const inbox = await mkdtemp(join(tmpdir(), "rag-inbox-"));
  for (const [path, text] of Object.entries(DOCS)) {
    await mkdir(join(inbox, path, ".."), { recursive: true });
    await writeFile(join(inbox, path), text);
  }
  const store = memoryStore();
  const embedded: string[] = [];
  const deps: Deps = {
    store: over.wrapStore === undefined ? store : over.wrapStore(store),
    embedder: {
      info: async () => ({ model: "test/embed", revision: "r1" }),
      embed: async (texts) => {
        // The one-word probe that learns the dimension is not an indexed text.
        if (!(texts.length === 1 && texts[0] === "dimension")) embedded.push(...texts);
        return texts.map((t) => fakeEmbed(t));
      },
    },
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
    settings: { language: "eng", embedBatch: 2, rerankBatch: 2 },
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
});
