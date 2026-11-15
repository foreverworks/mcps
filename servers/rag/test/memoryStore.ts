/**
 * The Store port in memory, for the server tests: the same contract as
 * infra/store.ts (which scripts/integration.ts drives against Postgres), with
 * cosine by brute force and "any word" full-text matching by set overlap.
 */
import type { ChunkToStore, CollectionRow, DocumentRow, SaveResult, Store, StoredChunk } from "../src/app/ports.js";
import { compare, samplePositions, type Compared } from "../src/domain/similar.js";

type Doc = Omit<DocumentRow, "chunks">;
type Row = StoredChunk & { readonly embedding: readonly number[] };

const words = (text: string): Set<string> =>
  new Set(
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  a.forEach((x, i) => {
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  });
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
};

export const memoryStore = (): Store & { readonly rows: () => readonly Row[] } => {
  let dimension: number | undefined;
  const collections = new Map<string, Omit<CollectionRow, "documents" | "chunks">>();
  const documents = new Map<string, Doc & { collection: string }>();
  let chunks: Row[] = [];
  const docKey = (c: string, s: string) => `${c}\u0000${s}`;
  const inScope = (r: Row, scope: { collections: readonly string[]; sourcePrefix?: string | undefined }) =>
    scope.collections.includes(r.collection) && (scope.sourcePrefix === undefined || r.source.startsWith(scope.sourcePrefix));
  const docRow = (d: Doc & { collection: string }): DocumentRow => ({ ...d, chunks: chunks.filter((r) => r.collection === d.collection && r.source === d.source).length });
  const under = (source: string, path: string) => source === path || source.startsWith(`${path}/`);
  const forget = (collection: string, gone: readonly Doc[]): number => {
    gone.forEach((d) => documents.delete(docKey(collection, d.source)));
    chunks = chunks.filter((r) => !(r.collection === collection && gone.some((d) => d.source === r.source)));
    return gone.length;
  };

  return {
    snapshotCollections: async (copies) => {
      if (copies.some((c) => collections.has(c.name) || !collections.has(c.from))) throw new Error("invalid snapshot");
      for (const copy of copies) {
        collections.set(copy.name, { ...collections.get(copy.from)!, name: copy.name, snapshot: true });
        for (const doc of [...documents.values()].filter((d) => d.collection === copy.from)) documents.set(docKey(copy.name, doc.source), { ...doc, collection: copy.name });
        chunks.push(...chunks.filter((c) => c.collection === copy.from).map((c) => ({ ...c, collection: copy.name })));
      }
    },
    rows: () => chunks,
    status: async () => ({ vector: "0.8.7", unaccent: "1.1", dimension, collections: collections.size, unindexed: [] }),
    ensureSchema: async (d) => {
      dimension ??= d;
    },
    collections: async () =>
      [...collections.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ ...c, documents: [...documents.values()].filter((d) => d.collection === c.name).length, chunks: chunks.filter((r) => r.collection === c.name).length })),
    collectionInfos: async () => [...collections.values()].sort((a, b) => a.name.localeCompare(b.name)),
    createCollection: async (row) => {
      if (collections.has(row.name)) return false;
      collections.set(row.name, { ...row, created: "2026-01-01T00:00:00.000Z", spent_tokens: 0, spent_neurons: 0 });
      return true;
    },
    // Every collection made here has its own index: there is no older one to build.
    ensureIndex: async () => false,
    setProvider: async (name, setting) => {
      const row = collections.get(name);
      if (row === undefined) return false;
      const { provider_probe: _old, ...rest } = row;
      collections.set(name, { ...rest, ...setting });
      return true;
    },
    addSpent: async (name, usage) => {
      const row = collections.get(name);
      if (row !== undefined) collections.set(name, { ...row, spent_tokens: row.spent_tokens + usage.tokens, spent_neurons: Math.round((row.spent_neurons + usage.neurons) * 1e6) / 1e6 });
    },
    dropCollection: async (name) => {
      if (!collections.has(name)) return undefined;
      const docs = [...documents.entries()].filter(([, d]) => d.collection === name);
      const gone = chunks.filter((r) => r.collection === name).length;
      docs.forEach(([k]) => documents.delete(k));
      chunks = chunks.filter((r) => r.collection !== name);
      collections.delete(name);
      return { documents: docs.length, chunks: gone };
    },
    document: async (c, s) => {
      const d = documents.get(docKey(c, s));
      return d === undefined ? undefined : docRow(d);
    },
    chunkIds: async (c, s) => new Set(chunks.filter((r) => r.collection === c && r.source === s).map((r) => r.id)),
    saveDocument: async (collection, document, list: readonly ChunkToStore[]): Promise<SaveResult> => {
      const keep = list.filter((c) => c.embedding === undefined).map((c) => c.id);
      const there = new Set(chunks.filter((r) => r.collection === collection && r.source === document.source).map((r) => r.id));
      const missing = keep.filter((id) => !there.has(id));
      if (missing.length > 0) return { saved: false, missing };
      documents.set(docKey(collection, document.source), { ...document, collection, indexed: "2026-01-01T00:00:00.000Z" });
      const ids = new Set(list.map((c) => c.id));
      const before = chunks.length;
      chunks = chunks.filter((r) => !(r.collection === collection && r.source === document.source && !ids.has(r.id)));
      const removed = before - chunks.length;
      let added = 0;
      for (const c of list) {
        const at = chunks.findIndex((r) => r.collection === collection && r.id === c.id);
        if (at >= 0) chunks[at] = { ...(chunks[at] as Row), ordinal: c.ordinal };
        else if (c.embedding !== undefined) {
          chunks.push({ collection, source: document.source, id: c.id, ordinal: c.ordinal, location: c.location, body: c.body, embedding: c.embedding });
          added += 1;
        }
      }
      return { saved: true, added, kept: keep.length, removed };
    },
    removeSources: async (collection, path) => forget(collection, [...documents.values()].filter((d) => d.collection === collection && under(d.source, path))),
    prune: async (collection, folder, { present, recursive }) =>
      forget(
        collection,
        [...documents.values()].filter((d) => {
          const below = d.source.slice(folder.length);
          return d.collection === collection && below.startsWith("/") && !present.has(d.source) && !below.includes("/.") && (recursive || !below.slice(1).includes("/"));
        }),
      ),
    documents: async (collection, { prefix, limit, offset }) => {
      const all = [...documents.values()].filter((d) => d.collection === collection && (prefix === undefined || d.source.startsWith(prefix))).sort((a, b) => a.source.localeCompare(b.source));
      return { total: all.length, rows: all.slice(offset, offset + limit).map(docRow) };
    },
    nearest: async (scope, embedding, limit) =>
      chunks
        .filter((r) => inScope(r, scope))
        .map((r) => ({ collection: r.collection, id: r.id, value: cosine(r.embedding, embedding) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit),
    similar: async ({ collection, source, candidates, sample }) => {
      // The same rules as the SQL (domain/similar.ts), by brute force: chunks in reading order, a long document sampled by position.
      const inOrder = (name: string) =>
        chunks.filter((r) => r.collection === collection && r.source === name).sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1));
      const own = inOrder(source);
      const compared = samplePositions(own.length, sample).map((i) => own[i] as Row);
      const outside = chunks.filter((r) => r.collection === collection && r.source !== source);
      const found = new Set<string>();
      for (const c of compared) {
        outside
          .map((r) => ({ source: r.source, value: cosine(r.embedding, c.embedding) }))
          .sort((a, b) => b.value - a.value)
          .slice(0, candidates)
          .forEach((hit) => found.add(hit.source));
      }
      const documents = [...found].flatMap((name): Compared[] => {
        const all = inOrder(name);
        const kept = samplePositions(all.length, sample).map((i) => all[i] as Row);
        const result = compare(compared.map((c) => kept.map((k) => cosine(c.embedding, k.embedding))));
        const top = result === undefined ? undefined : { chunk: kept[result.best.column] as Row, sourceChunk: compared[result.best.row] as Row };
        if (result === undefined || top === undefined) return [];
        return [
          {
            source: name,
            chunks: all.length,
            forward: result.forward,
            backward: result.backward,
            best: { value: result.best.value, chunk: { id: top.chunk.id, location: top.chunk.location }, sourceChunk: { id: top.sourceChunk.id, location: top.sourceChunk.location } },
          },
        ];
      });
      return { chunks: own.length, compared: compared.length, documents };
    },
    matching: async (scope, text, limit) => {
      const q = words(text);
      return chunks
        .filter((r) => inScope(r, scope))
        .map((r) => ({ collection: r.collection, id: r.id, value: [...words(r.body)].filter((w) => q.has(w)).length }))
        .filter((h) => h.value > 0)
        .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    chunks: async (keys) => keys.flatMap((k) => chunks.filter((r) => r.collection === k.collection && r.id === k.id)),
    range: async (c, s, from, to) => chunks.filter((r) => r.collection === c && r.source === s && r.ordinal >= from && r.ordinal <= to).sort((a, b) => a.ordinal - b.ordinal),
  };
};

/** A deterministic bag-of-words embedding: texts sharing words point the same way. */
export const fakeEmbed = (text: string, dimension = 64): number[] => {
  const v = Array.from({ length: dimension }, () => 0);
  for (const w of words(text)) {
    let h = 2166136261;
    for (const ch of w) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
    v[Math.abs(h) % dimension] = (v[Math.abs(h) % dimension] ?? 0) + 1;
  }
  return v;
};

/** Relevance as the share of the query's words a text holds. */
export const fakeRerankScore = (query: string, text: string): number => {
  const q = words(query);
  const t = words(text);
  return q.size === 0 ? 0 : [...q].filter((w) => t.has(w)).length / q.size;
};
