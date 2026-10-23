import { type FileSource, mapWithConcurrency, reportProgress } from "@foreverworks/mcp-kit";

import { addUsage, compactAnswer, fullAnswer, summarize, type CompactAnswer } from "../../domain/batch.js";
import { type BatchItem, MAX_UNNAMED_ROWS, parseBatchItems } from "../../domain/batchFile.js";
import { asAppError, fail, inputError, isFatal, type AppError } from "../../domain/errors.js";
import { checkFilters, countsOf, matches, type Top, topRows, type Where } from "../../domain/filters.js";
import type { Answer, Questions, State, Usage } from "../../domain/schema.js";
import { judged, type Judged, type Thresholds, verdictCounts } from "../../domain/verdicts.js";
import type { Deps } from "../ports.js";

export type AskInput = { readonly state: State; readonly questions: Questions; readonly model?: string | undefined };

/** One state, every question in one round trip: independent questions over the same state belong together. */
export const ask = async (deps: Deps, input: AskInput) => {
  const result = await deps.systemOne.ask({ state: input.state, questions: input.questions, model: input.model ?? deps.defaultModel });
  return {
    model: result.model,
    answers: Object.fromEntries(Object.entries(result.answers).map(([id, answer]) => [id, fullAnswer(answer)])),
    usage: result.usage,
  };
};

export type { BatchItem };

/** A saved row's verdicts, by question, when any question has thresholds. */
const verdictsLine = (j: Readonly<Record<string, Judged>> | undefined) =>
  j === undefined || Object.keys(j).length === 0 ? {} : { verdicts: Object.fromEntries(Object.entries(j).map(([q, v]) => [q, v.verdict])) };

export type BatchInput = {
  /** The rows typed into the call, or */
  readonly items?: readonly BatchItem[] | undefined;
  /** the rows in a file (JSONL or a JSON array), read by the kit's input-file reader. */
  readonly itemsFile?: FileSource | undefined;
  readonly questions: Questions;
  readonly model?: string | undefined;
  readonly concurrency: number;
  /** Each item's full distributions in the reply, not only its pick. */
  readonly probabilities: boolean;
  /** Which items the reply lists; the summary always covers all of them. */
  readonly list: "all" | "failed" | "none";
  /** Also write every item's full answers to the outbox, one JSON line each. */
  readonly save: boolean;
  /** Per question id: an act, review or abstain verdict on each row's answer. */
  readonly thresholds?: Readonly<Record<string, Thresholds>> | undefined;
  /** Only the answered rows meeting every condition are listed. */
  readonly where?: Where | undefined;
  /** Only the k rows with the highest value for one question, highest first. */
  readonly top?: Top | undefined;
  /** Tallies per question over the rows `where` keeps (every answered row without it). */
  readonly counts?: boolean | undefined;
};

type Outcome =
  | { readonly id: string; readonly ok: true; readonly model: string; readonly answers: Readonly<Record<string, Answer>>; readonly usage: Usage }
  | { readonly id: string; readonly ok: false; readonly error: AppError };

const idsOf = (items: readonly BatchItem[]): readonly string[] => {
  const unnamed = items.findIndex((item) => item.id === undefined);
  if (items.length > MAX_UNNAMED_ROWS && unnamed !== -1) {
    fail(inputError(`row ${unnamed} has no id: above ${MAX_UNNAMED_ROWS} rows every row needs one, so each answer is joined back by id, not by position`));
  }
  const ids = items.map((item, i) => item.id ?? String(i));
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(inputError(`item id "${id}" appears twice; ids name the rows of the answer`));
    seen.add(id);
  }
  return ids;
};

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The rows, from the call or from a file; a file's rows come with its sha256 and size, so the caller can check them. */
const rowsOf = async (deps: Deps, input: BatchInput) => {
  if ((input.items === undefined) === (input.itemsFile === undefined)) return fail(inputError("give the rows one way: items, or items_file"));
  if (input.items !== undefined) return { items: input.items, file: undefined };
  const file = await deps.readInput(input.itemsFile as FileSource);
  let text: string;
  try {
    text = UTF8.decode(file.bytes);
  } catch {
    return fail(inputError("items_file is not UTF-8 text"));
  }
  return { items: parseBatchItems(text), file: { sha256: file.sha256, size: file.size, ...(file.path === undefined ? {} : { path: file.path }) } };
};

/**
 * The same questions over many states, `concurrency` requests at a time. An
 * item that fails is reported and the rest go on; a failure that would fail
 * every item (no key, a refused key) stops the batch and fails the call, so a
 * thousand rows do not each earn their own 401. A client that asked hears the
 * count of rows done as they finish; one that cancels stops the rows not yet
 * asked.
 */
export const askBatch = async (deps: Deps, input: BatchInput) => {
  const thresholds = input.thresholds ?? {};
  const narrowed = input.where !== undefined || input.top !== undefined;
  checkFilters(input.questions, thresholds, input.where, input.top);
  if (narrowed && input.list === "failed") fail(inputError("where and top choose among answered rows; with list 'failed' they would choose nothing, so use list 'all' or 'none'"));
  const { items, file } = await rowsOf(deps, input);
  const ids = idsOf(items);
  const model = input.model ?? deps.defaultModel;
  const started = deps.now();
  const stop: { error?: AppError } = {};
  const progress = { done: 0 };
  const finished = <T>(outcome: T): T => {
    progress.done += 1;
    reportProgress(progress.done, items.length, `${progress.done} of ${items.length} rows`);
    return outcome;
  };

  const outcomes: readonly Outcome[] = await mapWithConcurrency(items, input.concurrency, async (item, i): Promise<Outcome> => {
    const id = ids[i] as string;
    if (stop.error !== undefined) return { id, ok: false, error: stop.error };
    try {
      const result = await deps.systemOne.ask({ state: item.state, questions: input.questions, model });
      return finished({ id, ok: true, model: result.model, answers: result.answers, usage: result.usage });
    } catch (thrown) {
      const error = asAppError(thrown);
      if (error === undefined) throw thrown;
      if (isFatal(error)) stop.error = error;
      return finished({ id, ok: false, error });
    }
  });
  if (stop.error !== undefined) return fail(stop.error);

  const answered = outcomes.flatMap((o) => (o.ok ? [{ ...o, judged: judged(o.answers, thresholds) }] : []));
  const failed = outcomes.flatMap((o) => (o.ok ? [] : [o]));
  const judgedOf = new Map<string, Readonly<Record<string, Judged>>>(answered.map((o) => [o.id, o.judged]));
  const kept = input.where === undefined ? answered : answered.filter((o) => matches(o.answers, o.judged, input.where as Where));
  const chosen = input.top === undefined ? kept : topRows(kept, input.top);
  const saved = input.save
    ? await deps.outbox.save(
        `batch-${new Date(started).toISOString().replace(/[:.]/g, "-")}.jsonl`,
        outcomes
          .map((o) =>
            JSON.stringify(
              o.ok
                ? { id: o.id, model: o.model, answers: o.answers, ...verdictsLine(judgedOf.get(o.id)), usage: o.usage }
                : { id: o.id, error: o.error },
            ),
          )
          .join("\n") + "\n",
      )
    : undefined;

  const listed: readonly Outcome[] = input.list === "all" ? (narrowed ? [...chosen, ...failed] : outcomes) : input.list === "failed" ? failed : [];
  const summary = summarize(
    answered.map((o) => o.answers),
    Object.keys(input.questions),
  );
  return {
    ...(file === undefined ? {} : { itemsFile: file }),
    items: outcomes.length,
    answered: answered.length,
    failed: failed.length,
    models: [...new Set(answered.map((o) => o.model))],
    usage: addUsage(answered.map((o) => o.usage)),
    ms: deps.now() - started,
    ...(Object.keys(thresholds).length === 0 ? {} : { thresholds }),
    summary: Object.fromEntries(
      Object.entries(summary).map(([id, s]) =>
        thresholds[id] === undefined ? [id, s] : [id, { ...s, verdicts: verdictCounts(answered.flatMap((o) => (o.judged[id] === undefined ? [] : [o.judged[id].verdict]))) }],
      ),
    ),
    ...(input.where === undefined ? {} : { matched: kept.length }),
    ...(input.counts === true ? { counts: countsOf(kept, input.questions) } : {}),
    ...(saved === undefined ? {} : { saved }),
    ...(input.list === "none"
      ? {}
      : {
          results: listed.map((o) =>
            o.ok
              ? {
                  id: o.id,
                  answers: Object.fromEntries(
                    Object.entries(o.answers).map(([q, a]): [string, CompactAnswer] => [q, compactAnswer(a, input.probabilities, judgedOf.get(o.id)?.[q])]),
                  ),
                }
              : { id: o.id, error: { kind: o.error.kind, message: o.error.message } },
          ),
        }),
  };
};
