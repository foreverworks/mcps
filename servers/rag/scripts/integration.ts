/**
 * The real store against a real Postgres with pgvector, with the real
 * extractors and a fake embedder and reranker (bag of words, word overlap):
 * everything the unit tests run in memory, through SQL. Run it against a
 * throwaway database; it creates and drops a collection named it-<time>.
 *
 *   docker run -d --rm --name rag-it -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 pgvector/pgvector:pg17
 *   docker exec rag-it psql -U postgres -c 'CREATE EXTENSION vector'
 *   RAG_DATABASE_URL=postgresql://postgres:x@127.0.0.1:55432/postgres npx tsx scripts/integration.ts
 */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Deps } from "../src/app/ports.js";
import { createCollection, dropCollection } from "../src/app/usecases/collections.js";
import { checkHealth } from "../src/app/usecases/health.js";
import { indexPath, listSources, removeSource } from "../src/app/usecases/indexing.js";
import { expand, search } from "../src/app/usecases/search.js";
import { makePool } from "../src/infra/database.js";
import { makeExtractor } from "../src/infra/extract.js";
import { makeSources } from "../src/infra/sources.js";
import { makeStore } from "../src/infra/store.js";
import { fakeEmbed, fakeRerankScore } from "../test/memoryStore.js";

const main = async (): Promise<void> => {
  const folder = await mkdtemp(join(tmpdir(), "rag-it-"));
  await cp(join(import.meta.dirname, "..", "test", "fixtures"), folder, { recursive: true });
  await writeFile(join(folder, "lease.md"), "# Lease\n\n## Repairs\n\nMajor repairs to the structure are paid by the landlord in full.\n");
  const pool = makePool(process.env);
  // A remote provider that embeds as the local one does, and bills a token per word.
  const remote = {
    provider: "cloudflare" as const,
    model: "fake/bow-remote",
    batch: 5,
    missing: async () => [],
    embed: async (texts: readonly string[]) => ({ vectors: texts.map((t) => fakeEmbed(t, 128)), usage: { requests: 1, texts: texts.length, tokens: texts.join(" ").split(/\s+/u).length, neurons: 0.001 } }),
  };
  const models = [
    { name: "bow", embedder: { info: async () => ({ model: "fake/bow", revision: "1" }), embed: async (texts: readonly string[]) => texts.map((t) => fakeEmbed(t, 128)) }, remote: { cloudflare: remote } },
    // A second model in another space (its words salted), with a prompt for questions.
    {
      name: "salted",
      queryPrompt: "query",
      embedder: { info: async () => ({ model: "fake/salted", revision: "2" }), embed: async (texts: readonly string[]) => texts.map((t) => fakeEmbed(t.replace(/(\p{L}+)/gu, "$1x"), 128)) },
      remote: {},
    },
  ];
  const deps: Deps = {
    store: makeStore(pool),
    models: () => models,
    providers: { cloudflare: { missing: remote.missing } },
    reranker: { info: async () => ({ model: "fake/overlap" }), rerank: async (q, texts) => texts.map((t, index) => ({ index, score: fakeRerankScore(q, t) })).sort((a, b) => b.score - a.score) },
    extractor: makeExtractor(),
    sources: makeSources([folder], { maxBytes: 50 * 1024 * 1024 }),
    settings: { language: "ron", embedBatch: 8, rerankBatch: 4, remoteConcurrency: 3 },
    now: () => new Date(),
  };
  const name = `it-${Date.now()}`;
  const other = `${name}-salted`;
  const ownIndex = async (collection: string): Promise<boolean> =>
    ((await (await pool()).query("SELECT 1 FROM pg_class WHERE relname = 'rag_hnsw_' || left(md5($1), 16)", [collection])).rowCount ?? 0) > 0;
  try {
    console.log("health:", JSON.stringify(await checkHealth(deps)).slice(0, 400));
    assert.equal((await createCollection(deps, { name, description: "integration" })).created, true);
    // The provider columns: moved to the remote provider (probe passes) and back, recorded both ways.
    assert.equal((await createCollection(deps, { name, provider: "cloudflare" })).collection.provider, "cloudflare");
    assert.equal((await createCollection(deps, { name, provider: "local" })).collection.provider_model, "fake/bow@1");
    const first = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    console.log("index:", JSON.stringify(first));
    assert.equal(first.failed, 0);
    assert.equal(first.indexed, 5);

    const garden = await search(deps, { query: "Când se udă serele dimineața?", limit: 3, candidates: 10, rerank: true, maxChars: 400 });
    console.log("search (ro):", JSON.stringify(garden.results[0]));
    // Both scans hold the garden page; stamped.pdf also carries a page number, which must not stop its OCR.
    assert.ok([join(folder, "scan.pdf"), join(folder, "stamped.pdf")].includes(garden.results[0]?.source ?? ""));
    assert.ok(garden.results.some((r) => r.source === join(folder, "stamped.pdf")));
    const repairs = await search(deps, { query: "who pays major repairs structure", limit: 3, candidates: 10, rerank: true, maxChars: 400 });
    assert.equal(repairs.results[0]?.source, join(folder, "lease.md"));
    assert.equal(repairs.results[0]?.location, "Lease > Repairs");
    const scoped = await search(deps, { query: "lamp", sourcePrefix: join(folder, "text"), limit: 5, candidates: 10, rerank: false, maxChars: 200 });
    assert.ok(scoped.results.length > 0 && scoped.results.every((r) => r.source.startsWith(join(folder, "text"))));
    const around = await expand(deps, { collection: name, id: repairs.results[0]?.id ?? "", before: 2, after: 2 });
    assert.ok(around.chunks.some((c) => "hit" in c));

    const again = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.equal(again.unchanged, 5);
    await rm(join(folder, "notes.docx"));
    const pruned = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: true, maxFiles: 50, language: undefined });
    assert.equal(pruned.sources_pruned, 1);
    assert.equal((await listSources(deps, { collection: name, limit: 10, offset: 0 })).total, 4);

    // An edited file keeps the embeddings of its unchanged chunks.
    const lease = join(folder, "lease.md");
    await writeFile(lease, "# Lease\n\n## Repairs\n\nMajor repairs to the structure are paid by the landlord in full.\n\n## Keys\n\nBoth keys go back at the end.\n");
    const edited = await indexPath(deps, { collection: name, path: lease, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.deepEqual([edited.indexed, edited.chunks_embedded, edited.chunks_kept], [1, 1, 1]);

    // Chunks removed by another call between reading and saving are embedded again (the check runs under the lock).
    let race = true;
    const racing: Deps = {
      ...deps,
      store: {
        ...deps.store,
        chunkIds: async (c, src) => {
          const ids = await deps.store.chunkIds(c, src);
          if (race) {
            race = false;
            await deps.store.removeSources(c, src);
          }
          return ids;
        },
      },
    };
    await writeFile(lease, "# Lease\n\n## Repairs\n\nMajor repairs to the structure are paid by the landlord in full.\n\n## Keys\n\nBoth keys go back at the end, cut or not.\n");
    const raced = await indexPath(racing, { collection: name, path: lease, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.equal(raced.failed, 0);
    assert.equal((await deps.store.range(name, lease, 0, 100)).length, (await deps.store.document(name, lease))?.chunks);
    assert.equal((await deps.store.document(name, lease))?.chunks, 2);

    // NUL in a text file, a subfolder left alone by a prune that is not recursive, a folder removed by a path with extra slashes.
    await writeFile(join(folder, "meter.txt"), "Meter reading\u0000 taken in January.");
    await mkdir(join(folder, "sub"));
    await writeFile(join(folder, "sub", "inner.md"), "# Inner\n\nA file one folder down.");
    const more = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.deepEqual([more.failed, more.indexed, more.unchanged], [0, 2, 4]);
    await rm(join(folder, "meter.txt"));
    const flat = await indexPath(deps, { collection: name, path: folder, recursive: false, ocr: true, force: false, prune: true, maxFiles: 50, language: undefined });
    assert.equal(flat.sources_pruned, 1);
    assert.ok((await deps.store.document(name, join(folder, "sub", "inner.md"))) !== undefined);
    assert.equal((await removeSource(deps, { collection: name, path: `${folder}//sub/` })).documents_removed, 1);

    // The language is part of how a file was read: a change reads it again and keeps every embedding.
    const relang = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: "eng" });
    assert.deepEqual([relang.indexed + relang.skipped, relang.failed, relang.chunks_embedded > 0], [5, 0, true]);

    // A second model's collection: its own index, searched with its own model beside the first.
    assert.equal((await createCollection(deps, { name: other, embeddingModel: "salted" })).collection.model, "fake/salted@2");
    assert.ok((await ownIndex(name)) && (await ownIndex(other)));
    const salted = await indexPath(deps, { collection: other, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.equal(salted.failed, 0);
    const both = await search(deps, { query: "who pays major repairs structure", collections: [name, other], limit: 6, candidates: 12, rerank: true, maxChars: 200 });
    console.log("search (two models):", JSON.stringify("embedding_models" in both ? both.embedding_models : undefined));
    assert.deepEqual(new Set(both.results.slice(0, 2).map((r) => `${r.collection} ${r.source}`)), new Set([`${name} ${lease}`, `${other} ${lease}`]));

    // A collection made before each had an index of its own: create_collection builds it, then the shared one goes.
    await (await pool()).query(`DROP INDEX ${(await (await pool()).query("SELECT 'rag_hnsw_' || left(md5($1), 16) AS i", [other])).rows[0].i}`);
    assert.deepEqual((await checkHealth(deps)).database, { ok: true, ...(await deps.store.status()) });
    assert.ok((await deps.store.status()).unindexed.includes(other));
    assert.equal((await createCollection(deps, { name: other })).vector_index, "built: the collection had none of its own");
    assert.ok(await ownIndex(other));
    console.log("integration: ok");
  } finally {
    for (const c of [name, other]) console.log("drop:", JSON.stringify(await dropCollection(deps, c).catch((e: unknown) => String(e))), "index left:", await ownIndex(c));
    await (await pool()).end();
    await rm(folder, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
