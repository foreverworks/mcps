import { attachmentsOf, type Attachment } from "./attachments.js";
import { bodyOf, type HtmlToText } from "./body.js";
import { type Detail } from "./detail.js";
import { headersOf, namedHeaders } from "./mime.js";
import { originalOf } from "./threading.js";
import type { RawMessage, RawThread } from "./schema.js";

export type { RawMessage, RawThread };

/** What a summary needs off each message. Anything else is wire cost. */
export const SUMMARY_HEADERS = ["From", "To", "Cc", "Subject", "Date"] as const;
/** Message reads also retain identity across mailboxes and the sender's reply destination. */
export const MESSAGE_HEADERS = [...SUMMARY_HEADERS, "Message-ID", "Reply-To"] as const;



export type MessageView = {
  readonly id: string | undefined;
  readonly threadId: string | undefined;
  readonly labelIds: readonly string[];
  readonly snippet: string | undefined;
  readonly internalDate: string | undefined;
  readonly from: string | undefined;
  readonly messageId: string | undefined;
  readonly replyTo: string | undefined;
  readonly to: string | undefined;
  readonly cc: string | undefined;
  readonly subject: string | undefined;
  readonly date: string | undefined;
  readonly attachments?: readonly Attachment[];
  readonly body?: string | undefined;
  readonly bodySource?: string;
};

/**
 * One message, flattened. MIME parts and base64 blobs never survive.
 *
 * `metadata` omits `attachments` as well as the body, and that is not an
 * oversight. It is served by Gmail's format=metadata, which returns the
 * payload's headers and NOTHING else: `parts` is absent entirely, so an
 * attachment list built from it would be permanently empty. A key that is
 * always [] is worse than a missing key, because it reads as an answer. Ask for
 * `text` when you need to know what is attached.
 */
export const messageView = (msg: RawMessage, detail: Detail, htmlToText: HtmlToText): MessageView => {
  const payload = msg.payload ?? {};
  const h = originalOf(msg, namedHeaders(payload));
  const base = {
    id: msg.id ?? undefined,
    threadId: msg.threadId ?? undefined,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? undefined,
    internalDate: msg.internalDate ?? undefined,
    from: h.from,
    messageId: h.messageId,
    replyTo: h.replyTo,
    to: h.to,
    cc: h.cc,
    subject: h.subject,
    date: h.date,
  };
  return detail === "metadata"
    ? base
    : { ...base, attachments: attachmentsOf(payload), ...bodyOf(payload, detail, htmlToText) };
};

export type ThreadSummary = {
  readonly id: string;
  readonly snippet: string | undefined;
  readonly messageCount: number;
  readonly lastDate: string | undefined;
  readonly lastFrom: string | undefined;
  readonly subject: string | undefined;
};

/**
 * Summarise a thread fetched with format=metadata.
 *
 * Deliberately NO attachment field: measured against Gmail, format=metadata
 * returns the payload's headers and nothing else, `parts` is absent entirely,
 * so any attachment flag computed here would be permanently false. Filter with
 * the query (has:attachment) and read the real list from a full fetch.
 */
export const threadSummary = (thread: RawThread, id: string): ThreadSummary => {
  const messages = thread.messages ?? [];
  const last = messages.at(-1);
  const h = headersOf(last?.payload);
  return {
    id,
    snippet: thread.snippet ?? last?.snippet ?? undefined,
    messageCount: messages.length,
    lastDate: h["Date"],
    lastFrom: h["From"],
    subject: h["Subject"],
  };
};
