import type { Answer, Usage } from "./schema.js";
import type { Judged, Verdict } from "./verdicts.js";

/**
 * The pure half of a batch: what one item's answers look like in a reply, and
 * what a whole batch adds up to. No I/O; app/usecases/ask.ts does the calls.
 */

/** Probabilities in a reply keep three decimals: enough to rank and threshold, and a third of the tokens. */
const round3 = (x: number): number => Math.round(x * 1000) / 1000;

const rounded = (probabilities: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(probabilities).map(([k, v]) => [k, round3(v)]));

/**
 * One answer as `ask` returns it: TypeSafe's own, less a Score's `legend`,
 * which only repeats the levels the caller just sent.
 */
export const fullAnswer = (answer: Answer): Answer | Omit<Extract<Answer, { type: "score" }>, "legend"> => {
  if (answer.type !== "score") return answer;
  const { legend: _legend, ...rest } = answer;
  return rest;
};

export type CompactAnswer =
  | number
  | { readonly noul: number; readonly certainty: number; readonly verdict: Verdict }
  | { readonly choice: string; readonly confidence: number; readonly probabilities?: Record<string, number>; readonly verdict?: Verdict }
  | { readonly score: number; readonly confidence: number; readonly probabilities?: Record<string, number>; readonly verdict?: Verdict };

/**
 * One answer as a batch item carries it: a Noul is its probability, a Choice
 * its pick and confidence, a Score its value and confidence; the distribution
 * only when asked for. A question with thresholds adds the verdict, and a
 * Noul then becomes an object with its certainty; a Choice's or a Score's
 * certainty is its confidence, then shown rounded down like the number the
 * verdict was taken on.
 */
export const compactAnswer = (answer: Answer, withProbabilities: boolean, judged?: Judged): CompactAnswer => {
  const verdict = judged === undefined ? {} : { verdict: judged.verdict };
  switch (answer.type) {
    case "noul":
      return judged === undefined ? round3(answer.noul) : { noul: round3(answer.noul), certainty: judged.certainty, verdict: judged.verdict };
    case "choice":
      return {
        choice: answer.choice,
        confidence: judged?.certainty ?? round3(answer.confidence),
        ...(withProbabilities ? { probabilities: rounded(answer.probabilities) } : {}),
        ...verdict,
      };
    case "score":
      return {
        score: round3(answer.score),
        confidence: judged?.certainty ?? round3(answer.confidence),
        ...(withProbabilities ? { probabilities: rounded(answer.probabilities) } : {}),
        ...verdict,
      };
  }
};

/** A Noul at or above this reads as yes in a summary, at or below NO_AT_MOST as no. The items keep the values. */
export const YES_AT_LEAST = 0.7;
export const NO_AT_MOST = 0.3;

export type QuestionSummary =
  | { readonly type: "choice"; readonly answered: number; readonly counts: Readonly<Record<string, number>> }
  | { readonly type: "noul"; readonly answered: number; readonly mean: number; readonly yes: number; readonly no: number; readonly between: number }
  | { readonly type: "score"; readonly answered: number; readonly mean: number; readonly min: number; readonly max: number };

const mean = (xs: readonly number[]): number => round3(xs.reduce((a, b) => a + b, 0) / xs.length);

const summaryOf = (answers: readonly Answer[]): QuestionSummary | undefined => {
  const first = answers[0];
  if (first === undefined) return undefined;
  switch (first.type) {
    case "choice": {
      const counts: Record<string, number> = {};
      for (const a of answers) if (a.type === "choice") counts[a.choice] = (counts[a.choice] ?? 0) + 1;
      return { type: "choice", answered: answers.length, counts };
    }
    case "noul": {
      const values = answers.flatMap((a) => (a.type === "noul" ? [a.noul] : []));
      const yes = values.filter((v) => v >= YES_AT_LEAST).length;
      const no = values.filter((v) => v <= NO_AT_MOST).length;
      return { type: "noul", answered: values.length, mean: mean(values), yes, no, between: values.length - yes - no };
    }
    case "score": {
      const values = answers.flatMap((a) => (a.type === "score" ? [a.score] : []));
      return { type: "score", answered: values.length, mean: mean(values), min: round3(Math.min(...values)), max: round3(Math.max(...values)) };
    }
  }
};

/** Per question id, over every item that was answered; a question no item answered is left out. */
export const summarize = (answered: readonly Readonly<Record<string, Answer>>[], questionIds: readonly string[]): Record<string, QuestionSummary> =>
  Object.fromEntries(
    questionIds.flatMap((id) => {
      const summary = summaryOf(answered.flatMap((answers) => (answers[id] === undefined ? [] : [answers[id]])));
      return summary === undefined ? [] : [[id, summary]];
    }),
  );

/** A count TypeSafe left unreported (null) makes the total unknown, not smaller. */
const total = (counts: readonly (number | null)[]): number | null =>
  counts.reduce<number | null>((sum, n) => (sum === null || n === null ? null : sum + n), 0);

export const addUsage = (usages: readonly Usage[]): Usage => ({
  input_tokens: total(usages.map((u) => u.input_tokens)),
  output_tokens: total(usages.map((u) => u.output_tokens)),
});
