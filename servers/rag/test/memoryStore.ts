/**
 * The Store port in memory, for the server tests: the same contract as
 * infra/store.ts (which scripts/integration.ts drives against Postgres), with
 * cosine by brute force and "any word" full-text matching by set overlap.
 */
import type { ChunkToStore, CollectionRow, DocumentRow, Store, StoredChunk } from "../src/app/ports.js";

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

  return {
    rows: () => chunks,
    status: async () => ({ vector: "0.8.7", unaccent: "1.1", dimension, collections: collections.size }),
    ensureSchema: async (d) => {
      dimension ??= d;
    },
    collections: async () =>
      [...collections.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ ...c, documents: [...documents.values()].filter((d) => d.collection === c.name).length, chunks: chunks.filter((r) => r.collection === c.name).length })),
    createCollection: async (row) => {
      if (collections.has(row.name)) return false;
      collections.set(row.name, { ...row, created: "2026-01-01T00:00:00.000Z" });
      return true;
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
    saveDocument: async (collection, document, list: readonly ChunkToStore[]) => {
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
      return { added, kept: list.filter((c) => c.embedding === undefined).length, removed };
    },
    removeSources: async (collection, path, except = new Set()) => {
      const gone = [...documents.values()].filter((d) => d.collection === collection && under(d.source, path) && !except.has(d.source));
      gone.forEach((d) => documents.delete(docKey(collection, d.source)));
      chunks = chunks.filter((r) => !(r.collection === collection && gone.some((d) => d.source === r.source)));
      return gone.length;
    },
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
