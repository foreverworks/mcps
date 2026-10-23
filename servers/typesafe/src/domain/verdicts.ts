import type { Answer } from "./schema.js";

/**
 * Act, review or abstain on one of Jev's answers, from thresholds the caller
 * sets per question. Pure.
 *
 * The verdict is about the answer, whatever it is: `act` means Jev is sure
 * enough of its yes or no, its pick or its level to act on it, `review` that a
 * person should look, `abstain` that the answer should not be used. What it
 * measures is the answer's certainty:
 *
 * - a noul's distance from undecided, |p - 0.5| x 2: p 0.95 and p 0.05 are both
 *   0.9, p 0.5 is 0;
 * - a choice's or a score's confidence, as TypeSafe answers it.
 *
 * The certainty is rounded DOWN to three places, the precision a reply shows,
 * and the verdict is taken on that number, so the two never disagree and the
 * gate is never looser than its thresholds.
 */

export type Verdict = "act" | "review" | "abstain";
export const VERDICTS = ["act", "review", "abstain"] as const satisfies readonly Verdict[];

export type Thresholds = { readonly act_above: number; readonly review_above: number };

/** Three places, rounded down. The nudge keeps 0.8999999999999999, which is 0.9 in decimal, from becoming 0.899. */
const floor3 = (x: number): number => Math.floor(x * 1000 + 1e-9) / 1000;

export const certaintyOf = (answer: Answer): number => floor3(answer.type === "noul" ? Math.abs(answer.noul - 0.5) * 2 : answer.confidence);

/** Strictly above each threshold: a certainty equal to act_above is a review. */
export const verdictOf = (certainty: number, thresholds: Thresholds): Verdict =>
  certainty > thresholds.act_above ? "act" : certainty > thresholds.review_above ? "review" : "abstain";

export type Judged = { readonly certainty: number; readonly verdict: Verdict };

/** A row's verdicts, for the questions that have thresholds and an answer. */
export const judged = (answers: Readonly<Record<string, Answer>>, thresholds: Readonly<Record<string, Thresholds>>): Readonly<Record<string, Judged>> =>
  Object.fromEntries(
    Object.entries(thresholds).flatMap(([id, t]) => {
      const answer = answers[id];
      if (answer === undefined) return [];
      const certainty = certaintyOf(answer);
      return [[id, { certainty, verdict: verdictOf(certainty, t) }]];
    }),
  );

export const verdictCounts = (verdicts: readonly Verdict[]): Readonly<Record<Verdict, number>> => ({
  act: verdicts.filter((v) => v === "act").length,
  review: verdicts.filter((v) => v === "review").length,
  abstain: verdicts.filter((v) => v === "abstain").length,
});
