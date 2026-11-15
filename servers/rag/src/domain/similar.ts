/**
 * How two documents of one collection are compared, as pure rules. The Postgres
 * store computes the same thing in SQL (infra/store.ts) and the in-memory store
 * of the tests computes it with these functions, so the two agree on what a
 * score means.
 *
 * A document is compared by up to SAMPLE_CHUNKS of its chunks (spread evenly by
 * position when it has more). For a source document S and another D, with
 * sim(i, j) the cosine of S's i-th compared chunk and D's j-th:
 *
 *   forward  = mean over S's chunks of the best sim to any chunk of D
 *   backward = mean over D's chunks of the best sim to any chunk of S
 *   score    = (forward + backward) / 2
 *
 * Forward says how much of S is said again in D, backward how much of D is said
 * in S. Their mean is 1 for identical documents and does not change when S and
 * D swap places. `best` is the single most alike pair of chunks.
 */

/** Chunks of a document taken into a comparison; a longer document is sampled. */
export const SAMPLE_CHUNKS = 64;

/** How many digits a score keeps in a reply: the rounding search gives its similarities. */
const DIGITS = 10_000;
export const round4 = (value: number): number => Math.round(value * DIGITS) / DIGITS;

/**
 * Positions (0-based, in reading order) of the chunks a comparison takes from a
 * document of `count` chunks: all of them up to `cap`, otherwise `cap` positions
 * spread evenly, the first and the last included. Position k of the cap is
 * round(k * (count - 1) / (cap - 1)), half up, written in integers so the SQL
 * (`(2 * k * (n - 1) + cap - 1) / (2 * (cap - 1))`) gives the same answer.
 */
export const samplePositions = (count: number, cap: number = SAMPLE_CHUNKS): readonly number[] => {
  if (count <= cap || cap < 2) return Array.from({ length: Math.min(count, Math.max(cap, 0)) }, (_, i) => i);
  return Array.from({ length: cap }, (_, k) => Math.floor((2 * k * (count - 1) + cap - 1) / (2 * (cap - 1))));
};

export type Comparison = {
  readonly forward: number;
  readonly backward: number;
  /** The most alike pair: its cosine, the source chunk's index (row) and the other's (column) in the matrix. */
  readonly best: { readonly value: number; readonly row: number; readonly column: number };
};

/**
 * Compares two documents from the cosines of their chunk pairs: `cosines[i][j]`
 * is the similarity of the source's i-th compared chunk and the other's j-th.
 * A tie for the best pair goes to the lowest row, then the lowest column.
 * Undefined when either document has no chunk to compare.
 */
export const compare = (cosines: readonly (readonly number[])[]): Comparison | undefined => {
  const rows = cosines.length;
  const columns = cosines[0]?.length ?? 0;
  if (rows === 0 || columns === 0) return undefined;
  const rowBest = Array.from({ length: rows }, () => -Infinity);
  const columnBest = Array.from({ length: columns }, () => -Infinity);
  let best = { value: -Infinity, row: 0, column: 0 };
  cosines.forEach((line, i) =>
    line.forEach((value, j) => {
      if (value > (rowBest[i] ?? -Infinity)) rowBest[i] = value;
      if (value > (columnBest[j] ?? -Infinity)) columnBest[j] = value;
      if (value > best.value) best = { value, row: i, column: j };
    }),
  );
  const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
  return { forward: mean(rowBest), backward: mean(columnBest), best };
};

/** The score of a pair of documents: the mean of how far each is said in the other. */
export const scoreOf = (forward: number, backward: number): number => (forward + backward) / 2;

/** A document's chunk as a reply names it, so a caller can `expand` it. */
export type ChunkRef = { readonly id: string; readonly location: string };

/** A document compared with the source, before ranking. */
export type Compared = {
  readonly source: string;
  /** All the document's chunks, not only the ones compared. */
  readonly chunks: number;
  readonly forward: number;
  readonly backward: number;
  readonly best: { readonly value: number; readonly chunk: ChunkRef; readonly sourceChunk: ChunkRef };
};

/** A compared document with its score, and whether it was sampled: it has more chunks than a comparison takes. */
export type Ranked = Compared & { readonly score: number; readonly sampled: boolean };

/**
 * Scores, rounds, drops what falls below `minScore`, and orders what is left:
 * best score first, equal scores by source. The order is taken on the rounded
 * score, the one a reader sees, so two documents that read alike are ordered by
 * their names and not by the last bits of a float; the same rounded score is
 * what `minScore` is compared with.
 */
export const rank = (documents: readonly Compared[], options: { readonly minScore: number; readonly limit: number }): readonly Ranked[] =>
  documents
    .map(
      (d): Ranked => ({
        ...d,
        score: round4(scoreOf(d.forward, d.backward)),
        sampled: d.chunks > SAMPLE_CHUNKS,
        forward: round4(d.forward),
        backward: round4(d.backward),
        best: { ...d.best, value: round4(d.best.value) },
      }),
    )
    .filter((d) => d.score >= options.minScore)
    .sort((a, b) => b.score - a.score || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
    .slice(0, options.limit);
