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
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Deps } from "../src/app/ports.js";
import { createCollection, dropCollection } from "../src/app/usecases/collections.js";
import { checkHealth } from "../src/app/usecases/health.js";
import { indexPath, listSources } from "../src/app/usecases/indexing.js";
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
  const deps: Deps = {
    store: makeStore(pool),
    embedder: { info: async () => ({ model: "fake/bow", revision: "1" }), embed: async (texts) => texts.map((t) => fakeEmbed(t, 128)) },
    reranker: { info: async () => ({ model: "fake/overlap" }), rerank: async (q, texts) => texts.map((t, index) => ({ index, score: fakeRerankScore(q, t) })).sort((a, b) => b.score - a.score) },
    extractor: makeExtractor(),
    sources: makeSources([folder], { maxBytes: 50 * 1024 * 1024 }),
    settings: { language: "ron", embedBatch: 8 },
    now: () => new Date(),
  };
  const name = `it-${Date.now()}`;
  try {
    console.log("health:", JSON.stringify(await checkHealth(deps)).slice(0, 400));
    assert.equal((await createCollection(deps, { name, description: "integration" })).created, true);
    const first = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    console.log("index:", JSON.stringify(first));
    assert.equal(first.failed, 0);
    assert.equal(first.indexed, 4);

    const garden = await search(deps, { query: "Când se udă serele dimineața?", limit: 3, candidates: 10, rerank: true, maxChars: 400 });
    console.log("search (ro):", JSON.stringify(garden.results[0]));
    assert.equal(garden.results[0]?.source, join(folder, "scan.pdf"));
    const repairs = await search(deps, { query: "who pays major repairs structure", limit: 3, candidates: 10, rerank: true, maxChars: 400 });
    assert.equal(repairs.results[0]?.source, join(folder, "lease.md"));
    assert.equal(repairs.results[0]?.location, "Lease > Repairs");
    const scoped = await search(deps, { query: "lamp", sourcePrefix: join(folder, "text"), limit: 5, candidates: 10, rerank: false, maxChars: 200 });
    assert.ok(scoped.results.length > 0 && scoped.results.every((r) => r.source.startsWith(join(folder, "text"))));
    const around = await expand(deps, { collection: name, id: repairs.results[0]?.id ?? "", before: 2, after: 2 });
    assert.ok(around.chunks.some((c) => "hit" in c));

    const again = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: false, maxFiles: 50, language: undefined });
    assert.equal(again.unchanged, 4);
    await rm(join(folder, "notes.docx"));
    const pruned = await indexPath(deps, { collection: name, path: folder, recursive: true, ocr: true, force: false, prune: true, maxFiles: 50, language: undefined });
    assert.equal(pruned.sources_pruned, 1);
    assert.equal((await listSources(deps, { collection: name, limit: 10, offset: 0 })).total, 3);
    console.log("integration: ok");
  } finally {
    console.log("drop:", JSON.stringify(await dropCollection(deps, name).catch((e: unknown) => String(e))));
    await (await pool()).end();
    await rm(folder, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
