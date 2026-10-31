import { fuse, fuseInOrder } from "../../domain/rrf.js";
import { asAppError, describeFailure, fail, inputError } from "../../domain/errors.js";
import type { CollectionInfo, Deps, EmbeddingModel, Hit } from "../ports.js";
import { findCollection, modelFor } from "./collections.js";

export type SearchArgs = {
  readonly query: string;
  /** Other phrasings of the same question; each is retrieved like the query, and the reranker reads the merged candidates against the query. */
  readonly also?: readonly string[] | undefined;
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

/**
 * Scores every text against the query, in requests of at most the batch the
 * endpoint takes; a cross-encoder scores each pair on its own, so the batches'
 * scores compare. Best first, each naming its index in `texts`.
 */
const rerankAll = async (deps: Deps, query: string, texts: readonly string[]): Promise<readonly { readonly index: number; readonly score: number }[]> => {
  const out: { index: number; score: number }[] = [];
  for (let i = 0; i < texts.length; i += deps.settings.rerankBatch) {
    const scores = await deps.reranker.rerank(query, texts.slice(i, i + deps.settings.rerankBatch));
    out.push(...scores.map((s) => ({ index: s.index + i, score: s.score })));
  }
  return out.sort((a, b) => b.score - a.score);
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/u, "")} …`);

/** The collections in scope grouped by the model that embeds their questions, in the order they were named. */
const byModel = async (deps: Deps, collections: readonly CollectionInfo[]) => {
  const models = await Promise.all(collections.map((c) => modelFor(deps, c)));
  const groups = new Map<string, { readonly model: EmbeddingModel; readonly collections: CollectionInfo[] }>();
  collections.forEach((c, i) => {
    const model = models[i] as EmbeddingModel;
    const group = groups.get(model.name) ?? { model, collections: [] };
    group.collections.push(c);
    groups.set(model.name, group);
  });
  return [...groups.values()];
};

/** The ranked lists of one phrasing: each model's nearest chunks, then the full-text matches. */
const listsFor = async (deps: Deps, groups: Awaited<ReturnType<typeof byModel>>, names: readonly string[], sourcePrefix: string | undefined, phrasing: string) => {
  // The full-text half gives up past its time bound (a question of only frequent words over a large
  // collection); the vector half then stands alone and the reply says so.
  let textTimedOut = false;
  const [nearest, matching] = await Promise.all([
    Promise.all(
      groups.map(async ({ model, collections }) => {
        const [vector] = await model.embedder.embed([phrasing], { prompt: model.queryPrompt });
        if (vector === undefined) return fail({ kind: "model", endpoint: "embed", message: `no vector for the query from ${model.name}` });
        const odd = collections.find((c) => c.dimension !== vector.length);
        if (odd !== undefined) return fail({ kind: "mismatch", message: `collection "${odd.name}" holds ${odd.dimension}-dimension vectors, and ${model.name} embedded the question in ${vector.length}` });
        return deps.store.nearest({ collections: collections.map((c) => c.name), sourcePrefix }, vector, RETRIEVE);
      }),
    ),
    deps.store.matching({ collections: names, sourcePrefix }, phrasing, RETRIEVE).catch((thrown: unknown): Hit[] => {
      const e = asAppError(thrown);
      if (e?.kind !== "database" || e.code !== "57014") throw thrown;
      textTimedOut = true;
      return [];
    }),
  ]);
  return { nearest, matching, textTimedOut };
};

/**
 * Hybrid search: the query's nearest chunks by embedding and its full-text
 * matches (any of its words, accents ignored), fused by reciprocal rank, and
 * the best candidates read again by the reranker, which decides the order.
 * Collections built with different models are searched each with its own:
 * the question is embedded once per model (with the prompt that model gives
 * questions), and each model's nearest chunks are one more ranked list in
 * the fusion, since their similarities do not compare.
 * Other phrasings of the question (`also`: a translation into the documents'
 * language, a keyword version) are each retrieved and fused the same way, in
 * parallel; their fused lists are fused again, the query's first on ties, and
 * the reranker reads those candidates against the query as asked.
 * If the reranker fails the fused order stands and the reply says so.
 */
export const search = async (deps: Deps, args: SearchArgs) => {
  const query = args.query.trim();
  if (query.length === 0) return fail(inputError("the query is empty"));
  const also = [...new Set((args.also ?? []).map((a) => a.trim()).filter((a) => a.length > 0 && a !== query))];
  const all = await deps.store.collections();
  const names = args.collections === undefined || args.collections.length === 0 ? all.map((c) => c.name) : [...new Set(args.collections)];
  if (names.length === 0) return { query, results: [], note: "there are no collections yet" };
  const groups = await byModel(deps, await Promise.all(names.map((name) => findCollection(deps, name))));
  const perPhrasing = await Promise.all([query, ...also].map((p) => listsFor(deps, groups, names, args.sourcePrefix, p)));
  const textNote = perPhrasing.some((p) => p.textTimedOut) ? "the full-text half ran past its time bound and was left out; results come from the vector half" : undefined;
  const keep = Math.max(args.candidates, args.limit);
  // One ranked list per model, then the full-text one: a chunk is in at most one of the first.
  const fusedEach = perPhrasing.map(({ nearest, matching }) => fuse([...nearest, matching].map((hits) => hits.map(keyOf))));
  const merged = fusedEach.length === 1 ? (fusedEach[0] ?? []) : fuseInOrder(fusedEach.map((f) => f.slice(0, RETRIEVE).map((x) => x.key)));
  const fused = merged.slice(0, keep);
  if (fused.length === 0) return { query, collections: names, results: [] };
  // Scores shown come from the query's own lists (and the first phrasing that found a chunk the query did not).
  const { nearest } = perPhrasing[0] ?? { nearest: [] };
  const textList = nearest.length;
  const ranksOf = new Map<string, readonly (number | undefined)[]>();
  for (const f of fusedEach) for (const x of f) if (!ranksOf.has(x.key)) ranksOf.set(x.key, x.ranks);
  const valueOf = (hits: readonly Hit[]) => new Map(hits.map((h) => [keyOf(h), h.value]));
  const similarity = valueOf(perPhrasing.flatMap((p) => p.nearest.flat()).reverse());
  const rank = valueOf(perPhrasing.flatMap((p) => p.matching).reverse());
  const rows = new Map((await deps.store.chunks(fused.map((f) => { const [collection = "", id = ""] = f.key.split("\u0000"); return { collection, id }; }))).map((c) => [keyOf(c), c]));
  const candidates = fused.flatMap((f) => { const chunk = rows.get(f.key); return chunk === undefined ? [] : [{ fused: f, chunk, ranks: ranksOf.get(f.key) ?? [] }]; });

  const vectorRank = (ranks: readonly (number | undefined)[]) => ranks.slice(0, textList).find((r) => r !== undefined);
  let order = candidates.map((c, i) => ({ ...c, rerank: undefined as number | undefined, i }));
  let rerankNote: string | undefined;
  if (args.rerank && candidates.length > 1) {
    try {
      const scores = await rerankAll(deps, query, candidates.map((c) => c.chunk.body));
      order = scores.flatMap((s) => { const c = candidates[s.index]; return c === undefined ? [] : [{ ...c, rerank: s.score, i: s.index }]; });
    } catch (thrown) {
      rerankNote = `the reranker failed (${describeFailure(thrown)}); results are in fused order`;
    }
  }
  const result = (c: (typeof order)[number]) => ({
    collection: c.chunk.collection,
    id: c.chunk.id,
    source: c.chunk.source,
    location: c.chunk.location,
    text: clip(c.chunk.body, args.maxChars),
    scores: {
      ...(c.rerank === undefined ? {} : { rerank: Math.round(c.rerank * 10_000) / 10_000 }),
      fused: Math.round(c.fused.score * 100_000) / 100_000,
      ...(similarity.has(keyOf(c.chunk)) ? { similarity: Math.round((similarity.get(keyOf(c.chunk)) ?? 0) * 10_000) / 10_000 } : {}),
      ...(rank.has(keyOf(c.chunk)) && c.ranks[textList] !== undefined ? { text_rank: c.ranks[textList] } : {}),
      ...(vectorRank(c.ranks) === undefined ? {} : { vector_rank: vectorRank(c.ranks) }),
    },
  });
  return {
    query,
    ...(also.length === 0 ? {} : { also }),
    collections: names,
    ...(groups.length > 1 ? { embedding_models: groups.map((g) => ({ name: g.model.name, collections: g.collections.map((c) => c.name) })) } : {}),
    candidates: candidates.length,
    reranked: args.rerank && rerankNote === undefined && candidates.length > 1,
    ...(rerankNote === undefined && textNote === undefined ? {} : { note: [textNote, rerankNote].filter((n) => n !== undefined).join("; ") }),
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
