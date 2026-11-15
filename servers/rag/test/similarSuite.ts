/**
 * `similar` against any Store, with the vectors set by hand: the same documents
 * and the same expectations run on the in-memory store (similar.test.ts) and on
 * Postgres with pgvector (store.pg.test.ts), so the SQL means what the rules
 * in domain/similar.ts say. The vectors are one-hot (or a 0.6/0.8 mix), whose
 * cosines are exact in a database's single precision too.
 */
import { describe, expect, it } from "vitest";

import type { ChunkToStore, Store } from "../src/app/ports.js";
import { similar } from "../src/app/usecases/similar.js";
import { asAppError } from "../src/domain/errors.js";
import { samplePositions } from "../src/domain/similar.js";

export const DIMENSION = 5;

/** The collections the fixture makes, under the names a caller picks. */
export type SimilarNames = { readonly docs: string; readonly elsewhere: string; readonly long: string; readonly near: string };

const unit = (index: number): number[] => Array.from({ length: DIMENSION }, (_, i) => (i === index ? 1 : 0));
const mix = (...values: number[]): number[] => Array.from({ length: DIMENSION }, (_, i) => values[i] ?? 0);

type Fixture = { readonly source: string; readonly vectors: readonly (readonly number[])[]; readonly locations?: readonly string[] };

const NOTES = "/data/notes/";
const LONG = "/data/long/";
const NEAR = "/data/near/";

/** Two chunks, as a copy of a pricing note would have them. */
const pricing = (source: string): Fixture => ({ source, vectors: [unit(0), unit(1)], locations: ["Pricing > Plans", "Pricing > Billing"] });

const DOCS: readonly Fixture[] = [
  pricing(`${NOTES}pricing.md`),
  pricing(`${NOTES}pricing-copy.md`),
  pricing(`${NOTES}pricing-backup.md`),
  // Says all of pricing and one thing more.
  { source: `${NOTES}pricing-draft.md`, vectors: [unit(0), unit(1), unit(2)], locations: ["Pricing > Plans", "Pricing > Billing", "Pricing > Discounts"] },
  // One chunk worded between pricing's two.
  { source: `${NOTES}pricing-reworded.md`, vectors: [mix(0.6, 0.8)], locations: ["Pricing"] },
  { source: `${NOTES}garden.md`, vectors: [unit(2), unit(3)], locations: ["Garden", "Greenhouse"] },
  { source: `${NOTES}blank.md`, vectors: [] },
];

/** The same note under the same path in another collection, and one document only that collection has. */
const ELSEWHERE: readonly Fixture[] = [pricing(`${NOTES}pricing.md`), pricing(`${NOTES}only-elsewhere.md`)];

/**
 * A source of two chunks and six documents of one chunk each, placed so that each chunk of the source has an
 * unambiguous order of nearest documents: a, c, e for the first chunk and b, d, f for the second, with gaps
 * between their cosines (about 0.98, 0.8, 0.5 and then 0.2 or 0) that no index or single-precision sum can
 * reorder. So `candidates` of 1 must find exactly a and b, 2 exactly a to d, and 3 or more all six.
 */
const NEAR_DOCS: readonly Fixture[] = [
  { source: `${NEAR}source.md`, vectors: [unit(0), unit(1)] },
  { source: `${NEAR}a.md`, vectors: [mix(0.98, 0.2)] },
  { source: `${NEAR}b.md`, vectors: [mix(0.2, 0.98)] },
  { source: `${NEAR}c.md`, vectors: [mix(0.8, 0, 0.6)] },
  { source: `${NEAR}d.md`, vectors: [mix(0, 0.8, 0.6)] },
  { source: `${NEAR}e.md`, vectors: [mix(0.5, 0, 0, 0.866)] },
  { source: `${NEAR}f.md`, vectors: [mix(0, 0.5, 0, 0.866)] },
];

const longChunks = (changed: readonly number[]): number[][] => Array.from({ length: 70 }, (_, k) => (changed.includes(k) ? unit(4) : unit(k % 4)));
/** The first position a 70-chunk document leaves out when compared. */
const SKIPPED = [...Array(70).keys()].find((k) => !samplePositions(70).includes(k)) ?? -1;

const LONG_DOCS: readonly Fixture[] = [
  { source: `${LONG}a.md`, vectors: longChunks([]) },
  { source: `${LONG}a-copy.md`, vectors: longChunks([]) },
  // Differs at the first and last chunk, which a comparison always takes.
  { source: `${LONG}a-edges.md`, vectors: longChunks([0, 69]) },
  // Differs only where a comparison does not look.
  { source: `${LONG}a-middle.md`, vectors: longChunks([SKIPPED]) },
  { source: `${LONG}short.md`, vectors: [unit(0), unit(1), unit(2)] },
];

const save = async (store: Store, collection: string, docs: readonly Fixture[]): Promise<void> => {
  await store.createCollection({ name: collection, description: "", model: "test/model@1", dimension: DIMENSION, provider: "local", provider_model: "test/model@1" });
  for (const d of docs) {
    const chunks: ChunkToStore[] = d.vectors.map((embedding, i) => ({ id: `${d.source}#${i}`, ordinal: i, location: d.locations?.[i] ?? `part ${i + 1}`, body: `text ${i}`, embedding }));
    await store.saveDocument(collection, { source: d.source, sha256: "0", size: 1, kind: "md", pages: undefined, extraction: "" }, chunks);
  }
};

/** Puts the fixture into an empty store, one collection per name. */
export const fillSimilar = async (store: Store, names: SimilarNames): Promise<void> => {
  await store.ensureSchema(DIMENSION);
  await save(store, names.docs, DOCS);
  await save(store, names.elsewhere, ELSEWHERE);
  await save(store, names.long, LONG_DOCS);
  await save(store, names.near, NEAR_DOCS);
};

/**
 * Every source of the fixture with the `candidates` to try it with, for a caller that compares two stores on
 * all of them. The long collection is left out: its copies tie for every nearest place, and which tied chunk
 * an index returns is its own business.
 */
export const similarSources = (): readonly { readonly collection: "docs" | "near"; readonly source: string; readonly candidates: readonly number[] }[] => [
  ...DOCS.map((d) => ({ collection: "docs" as const, source: d.source, candidates: [50] })),
  ...NEAR_DOCS.map((d) => ({ collection: "near" as const, source: d.source, candidates: [1, 2, 3, 50] })),
];

const ARGS: { readonly limit: number; readonly minScore: number; readonly candidates: number } = { limit: 50, minScore: 0, candidates: 50 };

/** The expectations; `open` returns the one store filled by fillSimilar, with the names it was given, every time it is called. */
export const similarCases = (open: () => Promise<{ readonly store: Store; readonly names: SimilarNames }>): void => {
  const run = async (which: keyof SimilarNames, source: string, over: Partial<typeof ARGS> = {}) => {
    const { store, names } = await open();
    return similar({ store }, { collection: names[which], source, ...ARGS, ...over });
  };
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return undefined;
    } catch (thrown) {
      return asAppError(thrown);
    }
  };

  describe("similar", () => {
    it("ranks an identical copy first with score 1, then by how much of each is in the other, and the source itself never", async () => {
      const found = await run("docs", `${NOTES}pricing.md`);
      expect(found).toMatchObject({ source: `${NOTES}pricing.md`, chunks: 2, compared: 2, sampled: false });
      // Equal scores go by source, so backup comes before copy.
      expect(found.results.map((r) => [r.source.slice(NOTES.length), r.score])).toEqual([
        ["pricing-backup.md", 1],
        ["pricing-copy.md", 1],
        ["pricing-draft.md", 0.8333],
        ["pricing-reworded.md", 0.75],
        ["garden.md", 0],
      ]);
      expect(found.results.map((r) => r.source)).not.toContain(`${NOTES}pricing.md`);
      expect(found.results.every((r) => r.sampled === false)).toBe(true);
      // Nothing from the other collection, whose pricing.md is a copy and whose other note is one too.
      expect(found.results.map((r) => r.source)).not.toContain(`${NOTES}only-elsewhere.md`);
      const by = (name: string) => found.results.find((r) => r.source === `${NOTES}${name}`);
      expect(by("pricing-copy.md")).toMatchObject({ forward: 1, backward: 1, chunks: 2 });
      expect(by("pricing-draft.md")).toMatchObject({ forward: 1, backward: 0.6667, chunks: 3 });
      expect(by("pricing-reworded.md")).toMatchObject({ forward: 0.7, backward: 0.8, chunks: 1 });
      expect(by("garden.md")).toMatchObject({ forward: 0, backward: 0 });
    });

    it("scores a pair the same from either side, forward and backward swapping places", async () => {
      const back = await run("docs", `${NOTES}pricing-draft.md`);
      expect(back.results.find((r) => r.source === `${NOTES}pricing.md`)).toMatchObject({ score: 0.8333, forward: 0.6667, backward: 1 });
    });

    it("names the closest pair of chunks, each by its id and location, the lowest position first on a tie", async () => {
      const found = await run("docs", `${NOTES}pricing.md`);
      const best = (name: string) => found.results.find((r) => r.source === `${NOTES}${name}`)?.best;
      expect(best("pricing-copy.md")).toEqual({ value: 1, chunk: `${NOTES}pricing-copy.md#0`, location: "Pricing > Plans", source_chunk: `${NOTES}pricing.md#0`, source_location: "Pricing > Plans" });
      // The reworded chunk is nearer pricing's second chunk (0.8) than its first (0.6).
      expect(best("pricing-reworded.md")).toEqual({ value: 0.8, chunk: `${NOTES}pricing-reworded.md#0`, location: "Pricing", source_chunk: `${NOTES}pricing.md#1`, source_location: "Pricing > Billing" });
      expect(best("garden.md")).toMatchObject({ value: 0, chunk: `${NOTES}garden.md#0`, source_chunk: `${NOTES}pricing.md#0` });
    });

    it("keeps the best `limit` documents at or above `min_score`", async () => {
      const names = (r: { results: { source: string }[] }) => r.results.map((x) => x.source.slice(NOTES.length));
      expect(names(await run("docs", `${NOTES}pricing.md`, { limit: 3 }))).toEqual(["pricing-backup.md", "pricing-copy.md", "pricing-draft.md"]);
      expect(names(await run("docs", `${NOTES}pricing.md`, { minScore: 0.8 }))).toEqual(["pricing-backup.md", "pricing-copy.md", "pricing-draft.md"]);
      expect(names(await run("docs", `${NOTES}pricing.md`, { minScore: 0.8334 }))).toEqual(["pricing-backup.md", "pricing-copy.md"]);
      expect(names(await run("docs", `${NOTES}pricing.md`, { minScore: 1 }))).toEqual(["pricing-backup.md", "pricing-copy.md"]);
      expect(names(await run("docs", `${NOTES}pricing.md`, { limit: 1, minScore: 0.9 }))).toEqual(["pricing-backup.md"]);
    });

    it("finds as candidates the documents of each compared chunk's `candidates` nearest chunks outside the source, and only those", async () => {
      const found = async (candidates: number) => (await run("near", `${NEAR}source.md`, { candidates })).results.map((r) => r.source.slice(NEAR.length)).sort();
      // The first chunk's nearest are a, c, e and the second's b, d, f: one each finds a and b, two find a to d, three all six.
      expect(await found(1)).toEqual(["a.md", "b.md"]);
      expect(await found(2)).toEqual(["a.md", "b.md", "c.md", "d.md"]);
      expect(await found(3)).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"]);
      expect(await found(50)).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"]);
    });

    it("compares a long document by 64 chunks spread through it, the first and the last always among them", async () => {
      const found = await run("long", `${LONG}a.md`);
      expect(found).toMatchObject({ chunks: 70, compared: 64, sampled: true });
      // short.md may or may not be among the candidates: the long document's copies tie for every nearest place.
      expect(found.results.slice(0, 3).map((r) => [r.source.slice(LONG.length), r.score, r.chunks, r.sampled])).toEqual([
        ["a-copy.md", 1, 70, true],
        // Changed where a comparison does not look: the same as a copy.
        ["a-middle.md", 1, 70, true],
        // Two of its 64 compared chunks match nothing: backward is 62/64.
        ["a-edges.md", 0.9844, 70, true],
      ]);
      expect(found.results.find((r) => r.source === `${LONG}a-edges.md`)).toMatchObject({ forward: 1, backward: 0.9688 });
      // Seen from the other side, the source is whole and the long document, a result, is the one that is sampled, which its entry says.
      const short = await run("long", `${LONG}short.md`);
      expect(short).toMatchObject({ chunks: 3, compared: 3, sampled: false });
      expect(short.results.find((r) => r.source === `${LONG}a.md`)).toMatchObject({ chunks: 70, sampled: true, forward: 1 });
    });

    it("answers a document with no chunks with no results", async () => {
      const { names } = await open();
      expect(await run("docs", `${NOTES}blank.md`)).toEqual({ collection: names.docs, source: `${NOTES}blank.md`, chunks: 0, compared: 0, sampled: false, results: [] });
    });

    it("says not_found for a collection that does not exist and a source not indexed in the collection", async () => {
      const { store, names } = await open();
      const unknownCollection = await failure(similar({ store }, { collection: "nope", source: `${NOTES}pricing.md`, ...ARGS }));
      expect(unknownCollection).toMatchObject({ kind: "not_found" });
      expect(unknownCollection?.message).toContain('no collection named "nope"');
      // The other collection has this document; this one does not.
      const unknownSource = await failure(similar({ store }, { collection: names.elsewhere, source: `${NOTES}garden.md`, ...ARGS }));
      expect(unknownSource).toMatchObject({ kind: "not_found" });
      expect(unknownSource?.message).toContain("list_sources");
    });
  });
};
