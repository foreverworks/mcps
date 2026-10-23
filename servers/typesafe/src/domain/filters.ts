import { NO_AT_MOST, YES_AT_LEAST } from "./batch.js";
import { fail, inputError } from "./errors.js";
import type { Answer, Questions } from "./schema.js";
import { type Judged, type Thresholds, type Verdict, verdictCounts } from "./verdicts.js";

/**
 * Which of a batch's answered rows a reply lists, in which order, and what it
 * counts: `where`, `top` and `counts`. Pure. Every condition is checked
 * against the questions before a single request goes out, so a label that is
 * not an option fails the call, not a thousand rows.
 */

/** One question's condition; every part given must hold. */
export type Condition = {
  /** A noul: true is a yes as the summary counts it (p >= 0.7), false a no (p <= 0.3). A choice: the pick is this label, or one of these. */
  readonly is?: boolean | string | readonly string[] | undefined;
  /** Bounds, both included, on the value a row shows: a noul's probability, a score, a choice's confidence. */
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** The question's verdict (it needs thresholds). */
  readonly verdict?: Verdict | readonly Verdict[] | undefined;
};

/** Question id -> condition; a row passes when every condition holds. */
export type Where = Readonly<Record<string, Condition>>;

/** The k rows with the highest value for one noul or score question. */
export type Top = { readonly by: string; readonly k: number };

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** The number a row shows for an answer: a noul's probability, a score, a choice's confidence; three places. */
export const valueOf = (answer: Answer): number => round3(answer.type === "noul" ? answer.noul : answer.type === "score" ? answer.score : answer.confidence);

const listOf = <T>(x: T | readonly T[]): readonly T[] => (Array.isArray(x) ? (x as readonly T[]) : [x as T]);

const unknownQuestion = (id: string, what: string, questions: Questions): never =>
  fail(inputError(`${what} names "${id}", which is not one of the questions (${Object.keys(questions).join(", ")})`));

/** Refuses a where, top or thresholds that does not fit the questions. */
export const checkFilters = (
  questions: Questions,
  thresholds: Readonly<Record<string, Thresholds>>,
  where: Where | undefined,
  top: Top | undefined,
): void => {
  for (const [id, t] of Object.entries(thresholds)) {
    if (questions[id] === undefined) unknownQuestion(id, "thresholds", questions);
    if (t.review_above > t.act_above) fail(inputError(`thresholds.${id}: review_above (${t.review_above}) is above act_above (${t.act_above})`));
  }
  for (const [id, c] of Object.entries(where ?? {})) {
    const q = questions[id] ?? unknownQuestion(id, "where", questions);
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) fail(inputError(`where.${id}: min (${c.min}) is above max (${c.max})`));
    if (c.verdict !== undefined && thresholds[id] === undefined) fail(inputError(`where.${id} asks for a verdict, but "${id}" has no thresholds`));
    if (c.is === undefined) continue;
    if (q.type === "noul" && typeof c.is !== "boolean") fail(inputError(`where.${id}: a noul is true (a yes, p >= ${YES_AT_LEAST}) or false (a no, p <= ${NO_AT_MOST})`));
    if (q.type === "score") fail(inputError(`where.${id}: a score is filtered by min and max, not is`));
    if (q.type === "choice") {
      if (typeof c.is === "boolean") fail(inputError(`where.${id}: a choice is one of its labels, not ${String(c.is)}`));
      const labels = Object.keys(q.criteria);
      const strange = listOf(c.is as string | readonly string[]).filter((label) => !labels.includes(label));
      if (strange.length > 0) fail(inputError(`where.${id}: ${strange.map((l) => `"${l}"`).join(", ")} is not one of its labels (${labels.join(", ")})`));
    }
  }
  if (top !== undefined) {
    const q = questions[top.by] ?? unknownQuestion(top.by, "top.by", questions);
    if (q.type === "choice") fail(inputError(`top.by: "${top.by}" is a choice; rank by a noul's probability or a score`));
  }
};

const holds = (answer: Answer, c: Condition, judged: Judged | undefined): boolean => {
  if (c.is !== undefined) {
    if (answer.type === "noul" && (c.is === true ? answer.noul < YES_AT_LEAST : c.is === false ? answer.noul > NO_AT_MOST : true)) return false;
    if (answer.type === "choice" && !listOf(c.is as string | readonly string[]).includes(answer.choice)) return false;
  }
  const value = valueOf(answer);
  if (c.min !== undefined && value < c.min) return false;
  if (c.max !== undefined && value > c.max) return false;
  return c.verdict === undefined || (judged !== undefined && listOf(c.verdict).includes(judged.verdict));
};

/** Whether a row's answers meet every condition; a question the row has no answer to fails its condition. */
export const matches = (answers: Readonly<Record<string, Answer>>, judged: Readonly<Record<string, Judged>>, where: Where): boolean =>
  Object.entries(where).every(([id, c]) => {
    const answer = answers[id];
    return answer !== undefined && holds(answer, c, judged[id]);
  });

/** The k rows with the highest value for `top.by`, highest first; ties keep the rows' order. */
export const topRows = <R extends { readonly answers: Readonly<Record<string, Answer>> }>(rows: readonly R[], top: Top): readonly R[] =>
  rows
    .map((row, i) => ({ row, i, value: row.answers[top.by] === undefined ? -Infinity : valueOf(row.answers[top.by] as Answer) }))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .slice(0, top.k)
    .map((x) => x.row);

export type QuestionCounts =
  | { readonly type: "noul"; readonly yes: number; readonly no: number; readonly between: number; readonly verdicts?: Readonly<Record<Verdict, number>> }
  | { readonly type: "choice"; readonly counts: Readonly<Record<string, number>>; readonly verdicts?: Readonly<Record<Verdict, number>> }
  /** By the level nearest each row's score: "0" is the first level. */
  | { readonly type: "score"; readonly levels: Readonly<Record<string, number>>; readonly verdicts?: Readonly<Record<Verdict, number>> };

const tally = (keys: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const k of keys) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
};

/** Per question, tallies of the rows' answers, and of their verdicts where the question has thresholds. */
export const countsOf = (
  rows: readonly { readonly answers: Readonly<Record<string, Answer>>; readonly judged: Readonly<Record<string, Judged>> }[],
  questions: Questions,
): Record<string, QuestionCounts> =>
  Object.fromEntries(
    Object.entries(questions).flatMap(([id, q]): [string, QuestionCounts][] => {
      const answers = rows.flatMap((r) => (r.answers[id] === undefined ? [] : [r.answers[id] as Answer]));
      if (answers.length === 0) return [];
      const verdicts = rows.flatMap((r) => (r.judged[id] === undefined ? [] : [r.judged[id].verdict]));
      const judgedPart = verdicts.length === 0 ? {} : { verdicts: verdictCounts(verdicts) };
      switch (q.type) {
        case "noul": {
          const ps = answers.flatMap((a) => (a.type === "noul" ? [a.noul] : []));
          const yes = ps.filter((p) => p >= YES_AT_LEAST).length;
          const no = ps.filter((p) => p <= NO_AT_MOST).length;
          return [[id, { type: "noul", yes, no, between: ps.length - yes - no, ...judgedPart }]];
        }
        case "choice":
          return [[id, { type: "choice", counts: tally(answers.flatMap((a) => (a.type === "choice" ? [a.choice] : []))), ...judgedPart }]];
        case "score":
          return [[id, { type: "score", levels: tally(answers.flatMap((a) => (a.type === "score" ? [String(Math.round(a.score))] : []))), ...judgedPart }]];
        default:
          return [];
      }
    }),
  );
