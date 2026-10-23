import { failureLine, isFailed, parseLog, type Step, stepsOf, stepView, tail } from "../../domain/logs.js";
import type { Deps } from "../ports.js";

/**
 * A log, read from all its files in order and grouped into steps. Undefined
 * when there is no log at all (a job that never started), which is an answer,
 * not a failure.
 */
export const readSteps = async (deps: Deps, urls: readonly string[]): Promise<readonly Step[] | undefined> => {
  if (urls.length === 0) return undefined;
  const texts = await Promise.all(urls.map((url) => deps.logs.read(url)));
  return stepsOf(parseLog(texts.join("\n")).lines);
};

/** The failed step of a log, said in one line, with its last lines when asked. */
export const failedStepOf = (steps: readonly Step[] | undefined, lines: number) => {
  const failed = steps?.find(isFailed);
  return failed === undefined ? undefined : { step: failed.name, reason: failureLine(failed), ...(lines > 0 ? { tail: tail(failed, lines) } : {}) };
};

/** Every step as a line of the table: name, result, size, and its tail when asked. */
export const stepsTable = (steps: readonly Step[], lines: number) => steps.map((s) => stepView(s, lines));
