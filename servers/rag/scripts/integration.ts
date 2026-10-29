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
  const deps: Deps = {
    store: makeStore(pool),
    embedder: { info: async () => ({ model: "fake/bow", revision: "1" }), embed: async (texts) => texts.map((t) => fakeEmbed(t, 128)) },
    reranker: { info: async () => ({ model: "fake/overlap" }), rerank: async (q, texts) => texts.map((t, index) => ({ index, score: fakeRerankScore(q, t) })).sort((a, b) => b.score - a.score) },
    extractor: makeExtractor(),
    sources: makeSources([folder], { maxBytes: 50 * 1024 * 1024 }),
    settings: { language: "ron", embedBatch: 8, rerankBatch: 4 },
    now: () => new Date(),
  };
  const name = `it-${Date.now()}`;
  try {
    console.log("health:", JSON.stringify(await checkHealth(deps)).slice(0, 400));
    assert.equal((await createCollection(deps, { name, description: "integration" })).created, true);
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
