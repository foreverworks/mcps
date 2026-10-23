import { describeThrown } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { searchThreads, type SearchInput } from "./threads.js";

type Page = Awaited<ReturnType<typeof searchThreads>>;
type Attempt = { readonly deps: Deps; readonly page?: Page; readonly failure?: string };

/**
 * Newest first. A summary that could not be fetched carries no Date header at
 * all, so it sorts last rather than throwing or claiming the epoch.
 */
const when = (thread: object): number => {
  const raw = "lastDate" in thread ? (thread as { readonly lastDate?: string }).lastDate : undefined;
  const t = raw ? Date.parse(raw) : Number.NaN;
  return Number.isNaN(t) ? -Infinity : t;
};

export type AccountPage = {
  readonly account: string;
  readonly nextPageToken?: string;
  readonly resultSizeEstimate?: number;
  readonly error?: string;
};

/**
 * One query across several mailboxes.
 *
 * Why it exists: the questions people actually ask their mail ("where is
 * that invoice", "did they ever reply") do not know which mailbox the answer is
 * in, and running the same query twice by hand and merging it by eye is exactly
 * the work a tool should absorb.
 *
 * A mailbox that fails is REPORTED and the others still answer — a dead grant
 * on one account must not turn a two-account search into no search at all.
 * Paging stays per-account, because Gmail's page tokens are per-mailbox and
 * pretending otherwise would silently drop results.
 */
export const searchAccounts = async (accounts: readonly Deps[], input: SearchInput) => {
  const attempts: readonly Attempt[] = await Promise.all(
    accounts.map(
      async (deps): Promise<Attempt> =>
        searchThreads(deps, input).then(
          (page) => ({ deps, page }),
          (thrown: unknown) => ({ deps, failure: describeThrown(thrown) }),
        ),
    ),
  );

  const threads = attempts.flatMap((a) => (a.page?.threads ?? []).map((t) => ({ account: a.deps.account, ...t })));

  const pages: readonly AccountPage[] = attempts.map((a) => ({
    account: a.deps.account,
    ...(a.page?.nextPageToken ? { nextPageToken: a.page.nextPageToken } : {}),
    ...(a.page?.resultSizeEstimate == null ? {} : { resultSizeEstimate: a.page.resultSizeEstimate }),
    ...(a.failure ? { error: a.failure } : {}),
  }));

  return { threads: [...threads].sort((x, y) => when(y) - when(x)), accounts: pages };
};
