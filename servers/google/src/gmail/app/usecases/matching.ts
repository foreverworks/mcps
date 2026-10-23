import { asAppError, describeThrown, inputError, fail } from "../../domain/errors.js";
import { SUMMARY_HEADERS, threadSummary } from "../../domain/summaries.js";
import { mapWithConcurrency } from "../../infra/pool.js";
import type { Deps } from "../ports.js";
import { matchingThreadIds, withSecondPass } from "./bulk.js";
import { labelChange } from "./labelChange.js";
import { requireWrite } from "./writeGuard.js";

/** How many matched threads a dry run shows, enough to see whether the query means what it should. */
export const SAMPLE_SIZE = 10;

export type MatchingInput = {
  readonly query: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  /** Off by default at the tool: a dry run first, always. */
  readonly apply: boolean;
  readonly limit: number;
};

/**
 * Gmail's "select all conversations that match this search", then a label
 * change on every one of them: the bulk step of sorting a mailbox, where
 * modify_labels would need every id listed first.
 *
 * A dry run counts the matches and shows a sample, and changes nothing. A run
 * that applies refuses outright when the query matches more than `limit`, so
 * it never stops at an arbitrary thread and leaves the rest. Per thread, a
 * failure is reported and the others still change; a thread Gmail throttled
 * gets a second, slower pass first (bulk.ts).
 */
export const modifyLabelsMatching = async (deps: Deps, input: MatchingInput) => {
  await requireWrite(deps);
  const query = input.query.trim() || fail(inputError("a query is required; for the whole mailbox say so, e.g. 'in:anywhere'"));
  const change = await labelChange(deps, input.add, input.remove);
  if (change.add.length + change.remove.length === 0) return fail(inputError("nothing to add or remove"));
  const { ids, more } = await matchingThreadIds(deps, query, input.limit);
  const base = { account: deps.account, query, added: change.add, removed: change.remove, matched: ids.length, more };

  if (!input.apply) {
    const sampled = await deps.gmail.getThreads(ids.slice(0, SAMPLE_SIZE), { format: "metadata", metadataHeaders: SUMMARY_HEADERS });
    const sample = sampled.flatMap((r, i) => (r.ok ? [threadSummary(r.value, ids[i] as string)] : []));
    return {
      ...base,
      dryRun: true,
      sample,
      next: more
        ? `the query matches more than ${input.limit} threads: raise limit or narrow the query before applying`
        : "nothing changed; call again with dry_run false to apply",
    };
  }

  if (more) return fail(inputError(`the query matches more than ${input.limit} threads; raise limit or narrow the query. Nothing was changed.`));
  const outcomes = await withSecondPass(
    ids,
    (batch, concurrency) =>
      mapWithConcurrency(batch, concurrency, (id) =>
        deps.write.modifyThread(id, change).then(
          () => undefined,
          (thrown: unknown) => ({ id, thrown }),
        ),
      ),
    (o) => o !== undefined && asAppError(o.thrown)?.kind === "quota",
  );
  const failed = outcomes.flatMap((o) => (o ? [{ id: o.id, reason: describeThrown(o.thrown) }] : []));
  return { ...base, dryRun: false, modified: ids.length - failed.length, ...(failed.length ? { failed } : {}) };
};
