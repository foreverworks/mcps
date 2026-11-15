import { fail, notFound } from "../../domain/errors.js";
import { rank, SAMPLE_CHUNKS } from "../../domain/similar.js";
import type { Deps } from "../ports.js";
import { findCollection } from "./collections.js";

export type SimilarArgs = {
  readonly collection: string;
  readonly source: string;
  readonly limit: number;
  readonly minScore: number;
  readonly candidates: number;
};

/**
 * The documents of a collection that say most nearly what one of its documents
 * says. The stored vectors are compared, so no model is called: the candidates
 * are the documents holding the nearest chunks of the source's chunks (through
 * the collection's own vector index), and each is then scored exactly against
 * the source (domain/similar.ts). A source or a candidate of more than
 * SAMPLE_CHUNKS chunks is compared by that many spread evenly through it, and
 * the reply says which (`sampled`, for the source and for each result).
 */
export const similar = async (deps: Pick<Deps, "store">, args: SimilarArgs) => {
  await findCollection(deps, args.collection);
  if ((await deps.store.document(args.collection, args.source)) === undefined)
    return fail(notFound(`"${args.source}" is not indexed in collection "${args.collection}"; list_sources shows what is`));
  const found = await deps.store.similar({ collection: args.collection, source: args.source, candidates: args.candidates, sample: SAMPLE_CHUNKS });
  return {
    collection: args.collection,
    source: args.source,
    chunks: found.chunks,
    compared: found.compared,
    sampled: found.compared < found.chunks,
    results: rank(found.documents, { minScore: args.minScore, limit: args.limit }).map((d) => ({
      source: d.source,
      score: d.score,
      forward: d.forward,
      backward: d.backward,
      chunks: d.chunks,
      sampled: d.sampled,
      best: { value: d.best.value, chunk: d.best.chunk.id, location: d.best.chunk.location, source_chunk: d.best.sourceChunk.id, source_location: d.best.sourceChunk.location },
    })),
  };
};
