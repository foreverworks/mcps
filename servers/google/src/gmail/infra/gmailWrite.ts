import type { DraftListPage, FilterSpec, GmailWritePort, LabelSpec, RawDraft, RawFilter, SendAs } from "../app/ports.js";
import type { Label } from "../domain/labels.js";
import type { RawMessage, RawThread } from "../domain/summaries.js";
import type { Request } from "../../infra/httpJson.js";
import { seg } from "./gmailApi.js";

const ROOT = "https://gmail.googleapis.com";
const API = `${ROOT}/gmail/v1/users/me`;
const UPLOAD = `${ROOT}/upload/gmail/v1/users/me`;

/**
 * A whole message travels through the UPLOAD endpoints as multipart/related:
 * the JSON metadata (threadId), then the message itself as message/rfc822.
 *
 * Not the `raw` field of a JSON body, although that is the obvious call: the
 * upload path is the one Google documents up to 35 MB, which is what a
 * forwarded invoice with its attachments needs, and it needs no base64url
 * re-encoding of a message that is already mostly base64.
 */
const upload = (metadata: unknown, raw: string, boundary: string) => ({
  contentType: `multipart/related; boundary="${boundary}"`,
  data: [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "",
    raw,
    `--${boundary}--`,
    "",
  ].join("\r\n"),
});

/**
 * The Gmail write adapter: the only module that knows the write endpoints.
 * Every method says whether sending it twice is harmless, because the request
 * layer uses that to decide whether an ambiguous failure may be retried.
 */
export const makeGmailWrite = (request: Request, boundary: () => string): GmailWritePort => {
  const threaded = (threadId?: string) => (threadId ? { threadId } : {});

  return {
    sendAs: () => request<{ sendAs?: readonly SendAs[] }>(`${API}/settings/sendAs`),

    createDraft: (raw, threadId) =>
      request<RawDraft>(`${UPLOAD}/drafts`, {
        method: "POST",
        query: { uploadType: "multipart" },
        body: upload({ message: threaded(threadId) }, raw, boundary()),
        idempotent: false,
      }),

    updateDraft: (id, raw, threadId) =>
      request<RawDraft>(`${UPLOAD}/drafts/${seg(id)}`, {
        method: "PUT",
        query: { uploadType: "multipart" },
        body: upload({ id, message: threaded(threadId) }, raw, boundary()),
        idempotent: true,
      }),

    getDraft: (id, format) => request<RawDraft>(`${API}/drafts/${seg(id)}`, { query: { format } }),

    listDrafts: ({ query, maxResults, pageToken }) =>
      request<DraftListPage>(`${API}/drafts`, { query: { q: query, maxResults: Math.min(Math.max(maxResults, 1), 100), pageToken } }),

    deleteDraft: async (id) => {
      await request<void>(`${API}/drafts/${seg(id)}`, { method: "DELETE", idempotent: true });
    },

    sendDraft: (id) => request<RawMessage>(`${API}/drafts/send`, { method: "POST", json: { id }, idempotent: false }),

    sendMessage: (raw, threadId) =>
      request<RawMessage>(`${UPLOAD}/messages/send`, {
        method: "POST",
        query: { uploadType: "multipart" },
        body: upload(threaded(threadId), raw, boundary()),
        idempotent: false,
      }),

    modifyMessages: async (ids, { add, remove }) => {
      await request<void>(`${API}/messages/batchModify`, {
        method: "POST",
        json: { ids, addLabelIds: add, removeLabelIds: remove },
        idempotent: true,
      });
    },

    modifyThread: (id, { add, remove }) =>
      request<RawThread>(`${API}/threads/${seg(id)}/modify`, {
        method: "POST",
        json: { addLabelIds: add, removeLabelIds: remove },
        idempotent: true,
      }),

    trash: (target, id) => request(`${API}/${target}s/${seg(id)}/trash`, { method: "POST", idempotent: true }),
    untrash: (target, id) => request(`${API}/${target}s/${seg(id)}/untrash`, { method: "POST", idempotent: true }),

    createLabel: (spec: LabelSpec) => request<Label>(`${API}/labels`, { method: "POST", json: spec, idempotent: false }),
    updateLabel: (id, spec) => request<Label>(`${API}/labels/${seg(id)}`, { method: "PATCH", json: spec, idempotent: true }),
    deleteLabel: async (id) => {
      await request<void>(`${API}/labels/${seg(id)}`, { method: "DELETE", idempotent: true });
    },

    // Gmail has no filter update: a changed filter is a new one and a delete.
    createFilter: (spec: FilterSpec) => request<RawFilter>(`${API}/settings/filters`, { method: "POST", json: spec, idempotent: false }),
    deleteFilter: async (id) => {
      await request<void>(`${API}/settings/filters/${seg(id)}`, { method: "DELETE", idempotent: true });
    },
  };
};
