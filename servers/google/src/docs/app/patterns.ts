import { runInNewContext } from "node:vm";

import { fail, inputError } from "../domain/errors.js";
import type { Matcher } from "../domain/find.js";

/**
 * A regular expression, run where it cannot stall the process: in a fresh V8
 * context with a time limit, which interrupts a backtracking pattern mid-match
 * (measured: /(a+)+$/ on 40 a's and a "!" stopped at the 300 ms limit). Every
 * paragraph is matched in one run, so the limit is for the whole search.
 */
const LIMIT_MS = 1500;

/** At most this many matches per paragraph: a pattern that matches everywhere still answers. */
const PER_TEXT = 1000;

const SEARCH = `(() => {
  const re = new RegExp(source, flags);
  return texts.map((text) => {
    const out = [];
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null && out.length < cap; m = re.exec(text)) {
      out.push([m.index, m[0].length]);
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return out;
  });
})()`;

export const patternMatcher =
  (source: string, matchCase: boolean): Matcher =>
  (texts) => {
    try {
      new RegExp(source, "u");
    } catch (thrown) {
      return fail(inputError(`not a regular expression: ${thrown instanceof Error ? thrown.message : String(thrown)}`));
    }
    try {
      const found = runInNewContext(SEARCH, { source, flags: matchCase ? "gu" : "giu", texts, cap: PER_TEXT }, { timeout: LIMIT_MS }) as number[][][];
      return found.map((perText) => perText.filter((m) => (m[1] ?? 0) > 0).map((m) => [m[0] ?? 0, m[1] ?? 0] as const));
    } catch (thrown) {
      if ((thrown as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        return fail(inputError(`the pattern ran past ${LIMIT_MS} ms over this document and was stopped; make it less ambiguous (nested repetition backtracks)`));
      }
      throw thrown;
    }
  };
