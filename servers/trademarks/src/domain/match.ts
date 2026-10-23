import type { Mark, MarkStatus, MatchMode, Relation } from "./mark.js";

/**
 * The comparison a name check rests on, the same for every office: case,
 * accents, spaces and punctuation do not make two marks different
 * ("Blue Night", "BLUENIGHT" and "blue-night" are identical), because an
 * examiner would not let them. `gap` replaces each run of spaces and
 * punctuation (nothing, by default; " " to keep the words apart).
 */
export const folded = (text: string, gap = ""): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, gap)
    .trim();

export const relationOf = (name: string, mark: string | null): Relation => {
  const wanted = folded(name);
  const got = folded(mark ?? "");
  if (got === wanted) return "identical";
  return wanted.length > 0 && got.includes(wanted) ? "contains" : "similar";
};

/** Whether a mark in this relation answers a search in this mode. */
export const admits = (mode: MatchMode, relation: Relation): boolean =>
  mode === "similar" || relation === "identical" || (mode === "word" && relation === "contains");

/** No wanted classes means every class. */
export const inClasses = (classes: readonly number[], wanted: readonly number[]): boolean =>
  wanted.length === 0 || classes.some((c) => wanted.includes(c));

const RELATION_RANK: Readonly<Record<Relation, number>> = { identical: 0, contains: 1, similar: 2 };
const STATUS_RANK: Readonly<Record<MarkStatus, number>> = { registered: 0, pending: 1, dead: 2 };

export type Hit = Mark & { readonly relation: Relation; readonly similarity?: number };

/**
 * Closest first. Among identical marks, and among those containing the name,
 * the ones that stand in the way (registered, then pending) first; among the
 * merely similar, the most alike by this server's score (similarity.ts), then
 * the source's own order, which is its relevance.
 */
export const ranked = (hits: readonly Hit[]): readonly Hit[] =>
  hits
    .map((hit, i) => ({ hit, i }))
    .sort(
      (a, b) =>
        RELATION_RANK[a.hit.relation] - RELATION_RANK[b.hit.relation] ||
        (a.hit.relation === "similar" ? (b.hit.similarity ?? -1) - (a.hit.similarity ?? -1) : STATUS_RANK[a.hit.status] - STATUS_RANK[b.hit.status]) ||
        a.i - b.i,
    )
    .map(({ hit }) => hit);

export const countByRelation = (hits: readonly Hit[]): Readonly<Record<Relation, number>> => ({
  identical: hits.filter((h) => h.relation === "identical").length,
  contains: hits.filter((h) => h.relation === "contains").length,
  similar: hits.filter((h) => h.relation === "similar").length,
});
