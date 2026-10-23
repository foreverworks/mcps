import { mapWithConcurrency } from "./concurrency.js";

/**
 * The shell modes' contract (`--health`, `--refresh`): ONE line per check,
 * starting with the server's prefix, and an exit code.
 *
 * THE LINE IS PART OF THE CONTRACT, not just the code. It lets the daily
 * maintenance tell "this ran and reached a verdict" from "this crashed before
 * it could say anything", which matters because a stale checkout or a missing
 * build would otherwise be reported as a dead grant and send an operator to fix
 * something that was never broken.
 *
 *   0  OK         the grant, key or credentials work
 *   1  PERMANENT  a human has to act (FAIL)
 *   2  TRANSIENT  the service was unwell, or a deadline is coming (WARN).
 *                 Deliberately NOT an alarm on its own: waking somebody for a
 *                 5xx is how a check stops being believed.
 *
 * What each server decides is which of its failures need a human
 * (`needsHuman`) and what the remedy is; the line's shape is this module's.
 */
export const OK = 0;
export const PERMANENT = 1;
export const TRANSIENT = 2;

export type Verdict = { readonly code: number; readonly line: string };

/** The exit code is the WORST line: a live personal account must not mask a dead work one. */
export const worst = (codes: readonly number[]): number =>
  codes.includes(PERMANENT) ? PERMANENT : codes.includes(TRANSIENT) ? TRANSIENT : OK;

/** A failure as a verdict, and the word its line leads with. */
export const verdictOf = (needsHuman: boolean): { readonly code: number; readonly word: "FAIL" | "WARN" } =>
  needsHuman ? { code: PERMANENT, word: "FAIL" } : { code: TRANSIENT, word: "WARN" };

/**
 * One at a time, in order. The lines are read by a human in a journal, and two
 * accounts interleaving their verdicts saves nothing worth that.
 */
export const inSeries = <T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<readonly R[]> =>
  mapWithConcurrency(items, 1, (item) => run(item));

export type VerdictVocabulary<E> = {
  /** `ANAF`, `OBLIO`: what every line of this server starts with. */
  readonly prefix: string;
  readonly asAppError: (thrown: unknown) => E | undefined;
  /** Refreshing, waiting or retrying cannot fix it; somebody has to act. */
  readonly needsHuman: (error: E) => boolean;
  readonly remedyFor: (error: E) => string;
  /** What the line says about the failure: its message unless the server names more (an OAuth code). */
  readonly labelOf?: (error: E) => string;
};

/**
 * Whatever was thrown, as ONE line with the remedy an operator can act on.
 * `context` goes before the failure (`account=work`) when a server checks
 * several things in one run. An unrecognised throw is a FAIL: it is a bug, and
 * a bug needs a human.
 */
export const makeFailureVerdict =
  <E extends { readonly message: string }>({ prefix, asAppError, needsHuman, remedyFor, labelOf }: VerdictVocabulary<E>) =>
  (thrown: unknown, context = ""): Verdict => {
    const at = context === "" ? "" : `${context} `;
    const error = asAppError(thrown);
    if (error === undefined) return { code: PERMANENT, line: `${prefix}: FAIL ${at}unexpected: ${String(thrown)}` };
    const { code, word } = verdictOf(needsHuman(error));
    return { code, line: `${prefix}: ${word} ${at}${labelOf ? labelOf(error) : error.message} -- ${remedyFor(error)}` };
  };
