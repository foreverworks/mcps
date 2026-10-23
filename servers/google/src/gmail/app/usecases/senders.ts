import { breakdown, SENDER_HEADERS, threadSender } from "../../domain/senders.js";
import type { Deps } from "../ports.js";
import { matchingThreadIds, withSecondPass } from "./bulk.js";

export type SendersInput = { readonly query: string; readonly limit: number; readonly top: number };

/**
 * Who the threads matching a query come from, grouped by domain, busiest
 * first. One metadata read per thread (the From header and the labels): a few
 * hundred take seconds, past that Gmail's quota lets about 25 a second through
 * (bulk.ts), so a 3000-thread inbox takes about two minutes.
 */
export const senderBreakdown = async (deps: Deps, input: SendersInput) => {
  const { ids, more } = await matchingThreadIds(deps, input.query, input.limit);
  const fetched = await withSecondPass(
    ids,
    (batch, concurrency) => deps.gmail.getThreads(batch, { format: "metadata", metadataHeaders: SENDER_HEADERS, concurrency }),
    (r) => !r.ok && r.reason === "quota",
  );
  const senders = fetched.flatMap((r) => (r.ok ? [threadSender(r.value)] : []));
  const unreadable = fetched.length - senders.length;
  return {
    account: deps.account,
    query: input.query,
    scanned: ids.length,
    more,
    ...(unreadable ? { unreadable } : {}),
    ...breakdown(senders, input.top),
  };
};
