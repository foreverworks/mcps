import { type Detail } from "../../domain/detail.js";
import { messageView, MESSAGE_HEADERS, SUMMARY_HEADERS, threadSummary } from "../../domain/summaries.js";
import type { Deps } from "../ports.js";

export type SearchInput = { readonly query?: string; readonly maxResults: number; readonly pageToken?: string };

/**
 * Gmail has no bulk thread read, so the request COUNT is fixed and only the
 * latency is ours to win: the per-thread fetches go out concurrently and ask
 * only for the headers a summary reads.
 */
export const searchThreads = async ({ gmail }: Deps, input: SearchInput) => {
  const page = await gmail.listThreads(input);
  // A stub without an id cannot be fetched or shown; Gmail does not send one, and it is dropped if it did.
  const stubs = (page.threads ?? []).flatMap((t) => (t.id ? [{ ...t, id: t.id }] : []));
  const fetched = await gmail.getThreads(
    stubs.map((t) => t.id),
    { format: "metadata", metadataHeaders: SUMMARY_HEADERS },
  );

  const threads = stubs.map((stub, i) => {
    const result = fetched[i];
    if (!result || !result.ok) {
      return { id: stub.id, snippet: stub.snippet, partial: true, reason: result?.reason ?? "missing" };
    }
    const summary = threadSummary(result.value, stub.id);
    return { ...summary, snippet: summary.snippet ?? stub.snippet };
  });

  return { threads, nextPageToken: page.nextPageToken, resultSizeEstimate: page.resultSizeEstimate };
};

/** metadata needs no bodies, so it fetches the cheap format. */
const fetchOptions = (detail: Detail) =>
  detail === "metadata"
    ? { format: "metadata", metadataHeaders: MESSAGE_HEADERS }
    : { format: "full" };

export const readThread = async ({ gmail, htmlToText }: Deps, id: string, detail: Detail) => {
  const thread = await gmail.getThread(id, fetchOptions(detail));
  return {
    id: thread.id,
    messages: (thread.messages ?? []).map((m) => messageView(m, detail, htmlToText)),
  };
};

export const readMessage = async ({ gmail, htmlToText }: Deps, id: string, detail: Detail) =>
  messageView(await gmail.getMessage(id, fetchOptions(detail)), detail, htmlToText);

/** get_messages takes at most this many ids: 25 full bodies of up to 40,000 characters each is already a long answer. */
export const MAX_MESSAGES = 25;

/**
 * Several messages in one call, in the order asked, each id once. One that
 * cannot be read comes back as `{ id, partial, reason }` in its place, like a
 * thread in a search, so the rest still arrive.
 */
export const readMessages = async ({ gmail, htmlToText }: Deps, ids: readonly string[], detail: Detail) => {
  const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))];
  const fetched = await gmail.getMessages(unique, fetchOptions(detail));
  const messages = unique.map((id, i) => {
    const result = fetched[i];
    return result?.ok ? messageView(result.value, detail, htmlToText) : { id, partial: true, reason: result?.reason ?? "missing" };
  });
  const unread = messages.filter((m) => "partial" in m).length;
  return { messages, ...(unread ? { unreadable: unread } : {}) };
};
