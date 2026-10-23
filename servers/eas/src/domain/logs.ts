/**
 * An EAS log file: one JSON object per line (bunyan's shape), written by the
 * builder for a build, a workflow job or a submission. Each line names the step
 * it belongs to (`buildStepDisplayName`, else `buildStepId`, else the builder's
 * `phase`), and a step ends with a marker line (`end-step` with a `result`, or
 * `END_PHASE`). This is the grouping eas-cli's `workflow:logs` does, and the
 * thing it does not do: say in one line why a failed step failed.
 */

export type LogLine = {
  readonly time?: string;
  readonly msg: string;
  readonly step: string;
  readonly marker?: string;
  readonly result?: string;
  /** bunyan's level: 30 info, 40 warn, 50 error. */
  readonly level?: number;
};

export type Step = {
  readonly name: string;
  /** success, fail, skipped, ... as the end marker says; absent while the step runs or when it never closed. */
  readonly result?: string;
  readonly lines: readonly LogLine[];
};

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** The lines that are JSON and carry a message; the rest (a truncated tail, a stray blank) are counted, not fatal. */
export const parseLog = (raw: string): { readonly lines: readonly LogLine[]; readonly unparsed: number } => {
  const lines: LogLine[] = [];
  let unparsed = 0;
  for (const row of raw.split("\n")) {
    if (row.trim() === "") continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(row) as Record<string, unknown>;
    } catch {
      unparsed += 1;
      continue;
    }
    const msg = text(value["msg"]);
    const step = text(value["buildStepDisplayName"]) ?? text(value["buildStepId"]) ?? text(value["phase"]);
    if (msg === undefined || step === undefined) continue;
    const time = text(value["time"]);
    const marker = text(value["marker"]);
    const result = text(value["result"]);
    const level = typeof value["level"] === "number" ? value["level"] : undefined;
    lines.push({
      msg,
      step,
      ...(time === undefined ? {} : { time }),
      ...(marker === undefined ? {} : { marker }),
      ...(result === undefined ? {} : { result }),
      ...(level === undefined ? {} : { level }),
    });
  }
  return { lines, unparsed };
};

const END_MARKERS = new Set(["end-step", "END_PHASE"]);

/** The lines grouped by step, in the order the steps began. */
export const stepsOf = (lines: readonly LogLine[]): readonly Step[] => {
  const steps = new Map<string, { name: string; result?: string; lines: LogLine[] }>();
  for (const line of lines) {
    let step = steps.get(line.step);
    if (step === undefined) {
      step = { name: line.step, lines: [] };
      steps.set(line.step, step);
    }
    if (step.result === undefined && line.marker !== undefined && END_MARKERS.has(line.marker)) step.result = line.result ?? "";
    step.lines.push(line);
  }
  return [...steps.values()];
};

export const isFailed = (step: Step): boolean => step.result === "fail" || step.result === "failed";

/**
 * The lines that say nothing a reader needs: the step's own start and end
 * markers, and the builder's restatement that a script exited non-zero.
 * What remains is what the step's own command printed.
 */
const isBoilerplate = (line: LogLine): boolean =>
  line.marker !== undefined || /exited with non-zero code/.test(line.msg) || /^Build step ".*" failed$/.test(line.msg);

/**
 * Why a failed step failed, in one line: the last thing it printed that is not
 * boilerplate. "eas-cli failed to resolve submission config. Add EXPO_DEBUG..."
 * rather than "Build step "Prepare credentials" failed", which only restates the status.
 */
export const failureLine = (step: Step): string => {
  const said = step.lines.filter((line) => !isBoilerplate(line));
  const last = said.at(-1) ?? step.lines.at(-1);
  return last === undefined ? "(the step printed nothing)" : last.msg.trim();
};

/** A step's last `n` lines, boilerplate kept: in a tail the markers show where the step stopped. */
export const tail = (step: Step, n: number): readonly string[] => step.lines.slice(-n).map((line) => line.msg);

/** One step, as a tool shows it: its result, how many lines, and the last of them. */
export const stepView = (step: Step, lines: number) => ({
  step: step.name,
  result: step.result ?? "unfinished",
  lineCount: step.lines.length,
  ...(lines > 0 ? { tail: tail(step, lines) } : {}),
});
