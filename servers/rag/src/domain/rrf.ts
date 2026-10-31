/**
 * Reciprocal rank fusion (Cormack, Clarke and Büttcher, 2009): each list
 * contributes 1 / (k + rank) for every item it holds, ranks counted from 1.
 * Only the order inside each list matters, so a cosine similarity and a
 * full-text rank, whose scales have nothing in common, can be combined.
 */
export type Fused = {
  readonly key: string;
  readonly score: number;
  /** The item's rank in each input list, 1-based, or undefined where that list does not hold it. */
  readonly ranks: readonly (number | undefined)[];
};

/** k = 60 is the value the paper found robust; larger k flattens the advantage of the top ranks. */
export const RRF_K = 60;

export const fuse = (lists: readonly (readonly string[])[], k: number = RRF_K): readonly Fused[] => {
  const ranks = new Map<string, (number | undefined)[]>();
  lists.forEach((list, which) => {
    const seen = new Set<string>();
    list.forEach((key, index) => {
      if (seen.has(key)) return;
      seen.add(key);
      const entry = ranks.get(key) ?? lists.map(() => undefined);
      entry[which] = index + 1;
      ranks.set(key, entry);
    });
  });
  return [...ranks.entries()]
    .map(([key, r]) => ({ key, ranks: r, score: r.reduce<number>((sum, rank) => (rank === undefined ? sum : sum + 1 / (k + rank)), 0) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
};

/**
 * Reciprocal rank fusion of lists given in order of preference (a question
 * first, then its other phrasings): the same scores as `fuse`, but ties go to
 * the item that appears earliest in the earliest list, so the question as
 * asked wins them.
 */
export const fuseInOrder = (lists: readonly (readonly string[])[], k: number = RRF_K): readonly Fused[] => {
  const first = new Map<string, number>();
  lists.forEach((list, which) => list.forEach((key, index) => { if (!first.has(key)) first.set(key, which * 1_000_000 + index); }));
  return [...fuse(lists, k)].sort((a, b) => b.score - a.score || (first.get(a.key) ?? 0) - (first.get(b.key) ?? 0));
};
