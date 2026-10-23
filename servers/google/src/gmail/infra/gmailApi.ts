import type { FilterList, Fetched, GmailPort, HistoryPage, Profile, ThreadListPage } from "../app/ports.js";
import { apiError, asAppError, fail } from "../domain/errors.js";
import type { RawMessage, RawThread } from "../domain/summaries.js";
import type { GetJson } from "../../infra/httpJson.js";
import { makeTokenInfo } from "../../infra/tokenInfo.js";
import { unlessCancelled } from "@foreverworks/mcp-kit";
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from "./pool.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** An id as one path segment: a wrong id is Gmail's 400 or 404, never a different endpoint. */
export const seg = (id: string): string => encodeURIComponent(id);

/** threads.list's documented maximum. search_threads asks for 50 at most, because it reads every thread it lists; an id walk asks for all of it. */
const MAX_PAGE = 500;
const clamp = (n: number, hi: number) => Math.min(Math.max(Math.trunc(n), 1), hi);

/**
 * The Gmail adapter: the only module that knows this API's URLs and parameter
 * names. It satisfies GmailPort, which is all the use cases ever see.
 */
export const makeGmailApi = (
  getJson: GetJson,
  getToken: () => Promise<string>,
  concurrency = DEFAULT_CONCURRENCY,
): GmailPort => {
  const readOptions = (o: { format: string; metadataHeaders?: readonly string[] }) => ({
    format: o.format,
    // Without this Gmail returns every header it has (about 26 per message) to
    // serve the three or four anyone reads.
    metadataHeaders: o.metadataHeaders,
  });

  const getThread = (id: string, o: { format: string; metadataHeaders?: readonly string[] }) =>
    getJson<RawThread>(`${API}/threads/${seg(id)}`, readOptions(o));

  const getMessage = (id: string, o: { format: string; metadataHeaders?: readonly string[] }) =>
    getJson<RawMessage>(`${API}/messages/${seg(id)}`, readOptions(o));

  /** Fetches each id 16 at a time; a failure is the item's, a cancellation the whole call's. */
  const fetchEach = <T>(ids: readonly string[], limit: number, what: string, read: (id: string) => Promise<T>) =>
    mapWithConcurrency(ids, limit, async (id): Promise<Fetched<T>> => {
      try {
        return { ok: true, value: await read(id) };
      } catch (thrown) {
        unlessCancelled(`${what} stopped before every one was read`);
        const err = asAppError(thrown);
        if (!err) throw thrown;
        return { ok: false, reason: err.kind === "api" ? (err.reason ?? `http_${err.status}`) : err.kind };
      }
    });

  return {
    profile: () => getJson<Profile>(`${API}/profile`),

    /** Asks the ISSUER what the live token grants. credentials.json only declares. */
    tokenInfo: async () => makeTokenInfo(getJson)(await getToken()),

    labels: () => getJson(`${API}/labels`),

    filters: () => getJson<FilterList>(`${API}/settings/filters`),

    listThreads: ({ query, maxResults, pageToken }) =>
      getJson<ThreadListPage>(`${API}/threads`, {
        q: query,
        maxResults: clamp(maxResults, MAX_PAGE),
        pageToken,
      }),

    getThread,

    getThreads: (ids, o) => fetchEach(ids, o.concurrency ?? concurrency, "the threads", (id) => getThread(id, o)),

    getMessage,

    getMessages: (ids, o) => fetchEach(ids, o.concurrency ?? concurrency, "the messages", (id) => getMessage(id, o)),

    getAttachment: async (messageId, attachmentId) => {
      const payload = await getJson<{ data?: string; size?: number }>(`${API}/messages/${seg(messageId)}/attachments/${seg(attachmentId)}`);
      // An attachment with no data is a damaged answer, not an empty file, unless Gmail says it is empty.
      if (payload.data === undefined && payload.size !== 0) return fail(apiError(200, "Gmail sent no data for the attachment; nothing was saved"));
      const bytes = Buffer.from(payload.data ?? "", "base64url");
      // Gmail states the part's size beside its data: bytes that decode to another length were damaged on the way.
      if (typeof payload.size === "number" && payload.size !== bytes.length) {
        return fail(apiError(200, `Gmail sent ${bytes.length} bytes for an attachment it says holds ${payload.size}; nothing was saved`));
      }
      return bytes;
    },

    listHistory: ({ startHistoryId, maxResults, pageToken }) =>
      getJson<HistoryPage>(`${API}/history`, {
        startHistoryId,
        maxResults: clamp(maxResults, 500),
        historyTypes: ["messageAdded"],
        pageToken,
      }),
  };
};
