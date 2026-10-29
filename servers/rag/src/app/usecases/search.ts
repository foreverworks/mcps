import { fuse } from "../../domain/rrf.js";
import { describeFailure, fail, inputError } from "../../domain/errors.js";
import type { Deps, Hit, StoredChunk } from "../ports.js";
import { assertSameModel, embeddingModel, findCollection } from "./collections.js";

export type SearchArgs = {
  readonly query: string;
  readonly collections?: readonly string[] | undefined;
  readonly sourcePrefix?: string | undefined;
  readonly limit: number;
  readonly candidates: number;
  readonly rerank: boolean;
  readonly maxChars: number;
};

/** How deep each retriever looks before fusion; the reranker then reads the best `candidates` of the fused list. */
const RETRIEVE = 50;

const keyOf = (h: { readonly collection: string; readonly id: string }): string => `${h.collection}\u0000${h.id}`;

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/u, "")} …`);

/**
 * Hybrid search: the query's nearest chunks by embedding and its full-text
 * matches (any of its words, accents ignored), fused by reciprocal rank, and
 * the best candidates read again by the reranker, which decides the order.
 * If the reranker fails the fused order stands and the reply says so.
 */
export const search = async (deps: Deps, args: SearchArgs) => {
  const query = args.query.trim();
  if (query.length === 0) return fail(inputError("the query is empty"));
  const all = await deps.store.collections();
  const names = args.collections === undefined || args.collections.length === 0 ? all.map((c) => c.name) : [...new Set(args.collections)];
  if (names.length === 0) return { query, results: [], note: "there are no collections yet" };
  const model = await embeddingModel(deps);
  for (const name of names) assertSameModel(await findCollection(deps, name), model);
  const [vector] = await deps.embedder.embed([query]);
  if (vector === undefined) return fail({ kind: "model", endpoint: "embed", message: "no vector for the query" });
  const scope = { collections: names, sourcePrefix: args.sourcePrefix };
  const [nearest, matching] = await Promise.all([deps.store.nearest(scope, vector, RETRIEVE), deps.store.matching(scope, query, RETRIEVE)]);
  const fused = fuse([nearest.map(keyOf), matching.map(keyOf)]).slice(0, Math.max(args.candidates, args.limit));
  if (fused.length === 0) return { query, collections: names, results: [] };
  const valueOf = (hits: readonly Hit[]) => new Map(hits.map((h) => [keyOf(h), h.value]));
  const similarity = valueOf(nearest);
  const rank = valueOf(matching);
  const rows = new Map((await deps.store.chunks(fused.map((f) => { const [collection = "", id = ""] = f.key.split("\u0000"); return { collection, id }; }))).map((c) => [keyOf(c), c]));
  const candidates = fused.flatMap((f) => { const chunk = rows.get(f.key); return chunk === undefined ? [] : [{ fused: f, chunk }]; });

  let order = candidates.map((c, i) => ({ ...c, rerank: undefined as number | undefined, i }));
  let rerankNote: string | undefined;
  if (args.rerank && candidates.length > 1) {
    try {
      const scores = await deps.reranker.rerank(query, candidates.map((c) => c.chunk.body));
      order = scores.flatMap((s) => { const c = candidates[s.index]; return c === undefined ? [] : [{ ...c, rerank: s.score, i: s.index }]; });
    } catch (thrown) {
      rerankNote = `the reranker failed (${describeFailure(thrown)}); results are in fused order`;
    }
  }
  const result = (c: { readonly fused: (typeof candidates)[number]["fused"]; readonly chunk: StoredChunk; readonly rerank: number | undefined }) => ({
    collection: c.chunk.collection,
    id: c.chunk.id,
    source: c.chunk.source,
    location: c.chunk.location,
    text: clip(c.chunk.body, args.maxChars),
    scores: {
      ...(c.rerank === undefined ? {} : { rerank: Math.round(c.rerank * 10_000) / 10_000 }),
      fused: Math.round(c.fused.score * 100_000) / 100_000,
      ...(similarity.has(keyOf(c.chunk)) ? { similarity: Math.round((similarity.get(keyOf(c.chunk)) ?? 0) * 10_000) / 10_000 } : {}),
      ...(rank.has(keyOf(c.chunk)) ? { text_rank: c.fused.ranks[1] } : {}),
      ...(c.fused.ranks[0] === undefined ? {} : { vector_rank: c.fused.ranks[0] }),
    },
  });
  return {
    query,
    collections: names,
    candidates: candidates.length,
    reranked: args.rerank && rerankNote === undefined && candidates.length > 1,
    ...(rerankNote === undefined ? {} : { note: rerankNote }),
    results: order.slice(0, args.limit).map(result),
  };
};

/** The chunks before and after a hit in its document, the hit included and marked. */
export const expand = async (deps: Deps, args: { readonly collection: string; readonly id: string; readonly before: number; readonly after: number }) => {
  const [hit] = await deps.store.chunks([{ collection: args.collection, id: args.id }]);
  if (hit === undefined) return fail({ kind: "not_found", message: `no chunk ${args.id} in collection "${args.collection}"` });
  const rows = await deps.store.range(args.collection, hit.source, Math.max(0, hit.ordinal - args.before), hit.ordinal + args.after);
  return {
    collection: args.collection,
    source: hit.source,
    chunks: rows.map((r) => ({ id: r.id, ordinal: r.ordinal, location: r.location, ...(r.id === hit.id ? { hit: true } : {}), text: r.body })),
  };
};

/** A document's text as stored, chunk by chunk from `from`, until `maxChars` is reached. */
export const readDocument = async (deps: Deps, args: { readonly collection: string; readonly source: string; readonly from: number; readonly maxChars: number }) => {
  const document = await deps.store.document(args.collection, args.source);
  if (document === undefined) return fail({ kind: "not_found", message: `"${args.source}" is not indexed in collection "${args.collection}"; list_sources shows what is` });
  const rows = await deps.store.range(args.collection, args.source, args.from, args.from + 199);
  const out: { ordinal: number; location: string; text: string }[] = [];
  let size = 0;
  for (const r of rows) {
    if (out.length > 0 && size + r.body.length > args.maxChars) break;
    out.push({ ordinal: r.ordinal, location: r.location, text: r.body });
    size += r.body.length;
  }
  const last = out.at(-1)?.ordinal ?? args.from - 1;
  return {
    collection: args.collection,
    source: args.source,
    chunks_total: document.chunks,
    from: args.from,
    chunks: out,
    ...(last + 1 < document.chunks ? { next_from: last + 1 } : {}),
  };
};
