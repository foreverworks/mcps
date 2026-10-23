import { fail, inputError } from "./errors.js";
import type { RawRichText } from "./schema.js";

/**
 * Rich text, both ways. Out, it is the plain text Notion already computed for
 * each run (a mention reads as the name it shows). In, plain text becomes runs
 * of at most 2000 characters, Notion's limit per run, and at most 100 runs.
 */

/** Notion's limit on one text run's content. */
export const RUN_LIMIT = 2000;
/** Notion's limit on the runs in one rich-text value. */
export const MAX_RUNS = 100;

export const plainText = (runs: readonly RawRichText[] | undefined): string => (runs ?? []).map((r) => r.plain_text).join("");

/**
 * `text` in runs Notion accepts. Split by code point, so a character outside
 * the BMP (an emoji) is never cut in half; Notion counts UTF-16 units, and a
 * run of 2000 code points can be longer than that, so the split is by units
 * with the code point kept whole.
 */
export const toRuns = (text: string, what = "text"): readonly string[] => {
  const runs: string[] = [];
  let current = "";
  for (const char of text) {
    if (current.length + char.length > RUN_LIMIT) {
      runs.push(current);
      current = "";
    }
    current += char;
  }
  if (current.length > 0) runs.push(current);
  if (runs.length > MAX_RUNS) {
    return fail(inputError(`${what} is ${text.length} characters; Notion takes at most ${MAX_RUNS * RUN_LIMIT} in one property`));
  }
  return runs;
};
