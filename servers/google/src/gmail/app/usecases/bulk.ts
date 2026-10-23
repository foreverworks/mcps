import { DEFAULT_CONCURRENCY } from "../../infra/pool.js";
import type { Deps } from "../ports.js";

/**
 * Every thread id a query matches, up to `limit`, and whether it matches more.
 * Ids only, at threads.list's full page of 500, so a whole inbox is a handful
 * of requests; what to read of each thread is the caller's choice.
 */
export const matchingThreadIds = async ({ gmail }: Deps, query: string, limit: number) => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    // One past the limit, so "exactly limit" and "more than limit" read differently.
    const page = await gmail.listThreads({ query, maxResults: limit + 1 - ids.length, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(page.threads ?? []).flatMap((t) => (t.id ? [t.id] : [])));
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken && ids.length <= limit);
  return { ids: ids.slice(0, limit), more: ids.length > limit };
};

/**
 * How many requests the second pass keeps in flight.
 *
 * Gmail's per-user quota is 250 units a second and reading or changing a
 * thread costs 10, so past an initial burst about 25 threads a second get
 * through. DEFAULT_CONCURRENCY overruns that, and on a long run the request
 * layer's retries run out for some threads: on an inbox of a few thousand
 * threads, a first pass at full speed takes about two minutes and leaves a few
 * untouched. Those go round again, this few at a time, once the burst is over.
 */
export const SECOND_PASS_CONCURRENCY = 4;

/**
 * `run` over every item at full speed, then once more, slowly, over the ones
 * whose outcome says Gmail throttled them. Outcomes come back in item order.
 */
export const withSecondPass = async <T, R>(
  items: readonly T[],
  run: (batch: readonly T[], concurrency: number) => Promise<readonly R[]>,
  throttled: (outcome: R) => boolean,
): Promise<readonly R[]> => {
  const first = await run(items, DEFAULT_CONCURRENCY);
  const again = first.flatMap((outcome, i) => (throttled(outcome) ? [i] : []));
  if (!again.length) return first;
  const second = await run(
    again.map((i) => items[i] as T),
    SECOND_PASS_CONCURRENCY,
  );
  const redone = new Map(again.map((i, k) => [i, second[k] as R]));
  // has(), not ??: an outcome may itself be undefined (a change that succeeded).
  return first.map((outcome, i) => (redone.has(i) ? (redone.get(i) as R) : outcome));
};
