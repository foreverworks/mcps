import { parseAddressList } from "../../domain/addresses.js";
import { buildMime, cidsIn, shownIn } from "../../domain/compose.js";
import { type Detail } from "../../domain/detail.js";
import { inputError, fail } from "../../domain/errors.js";
import { headersOf } from "../../domain/mime.js";
import { fullBodies } from "../../domain/quote.js";
import { messageView, SUMMARY_HEADERS } from "../../domain/summaries.js";
import { draftUrl } from "../../domain/webUrl.js";
import type { Deps } from "../ports.js";
import {
  attachmentFacts,
  attachmentsOf,
  bodiesOf,
  withinGuard,
  type ComposeInput,
  draftResult,
  fromOf,
  identityOf,
  originalAttachments,
  recipients,
  sentResult,
  shownImages,
} from "./compose.js";
import { requireWrite } from "./writeGuard.js";

/** A new message, saved as a draft. The default path for anything outward-facing. */
export const createDraft = async (deps: Deps, input: ComposeInput) => {
  await requireWrite(deps);
  const id = await identityOf(deps);
  const from = fromOf(id, input.from);
  const bodies = bodiesOf(deps, input);
  const attachments = withinGuard(await attachmentsOf(deps, input.attachments));
  const raw = buildMime(
    {
      ...(from ? { from } : {}),
      to: recipients(input.to, "to"),
      cc: recipients(input.cc, "cc"),
      bcc: recipients(input.bcc, "bcc"),
      subject: input.subject ?? "",
      ...bodies,
      attachments,
      references: [],
    },
    deps.boundary,
  );
  return { ...draftResult(deps, id, await deps.write.createDraft(raw)), ...attachmentFacts(attachments) };
};

/**
 * Change a draft. Only what is passed changes; the rest is carried over from
 * the draft as it stands, INCLUDING its threading, so editing a reply draft
 * cannot quietly turn it into a new conversation.
 *
 * Bodies move together: passing either body replaces both, because keeping an
 * old HTML body beside a new text one would send two different messages to
 * two kinds of client. Attachments are kept unless a list is passed, and an
 * empty list removes them. The images the body shows (a quote's) follow the
 * body, not the list: kept while the body shows them, gone with a new body that
 * does not.
 */
export const updateDraft = async (deps: Deps, draftId: string, input: ComposeInput) => {
  await requireWrite(deps);
  const [id, existing] = await Promise.all([identityOf(deps), deps.write.getDraft(draftId, "full")]);
  const msg = existing.message;
  if (!msg) return fail(inputError(`draft ${draftId} has no message`));
  const h = headersOf(msg.payload);
  const get = (name: string) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];

  const bodyGiven = input.bodyText !== undefined || input.bodyHtml !== undefined;
  const kept = fullBodies(msg.payload);
  const bodies = bodyGiven ? bodiesOf(deps, input) : kept.text === undefined && kept.html === undefined ? { text: "" } : kept;
  const from = input.from ? fromOf(id, input.from) : parseAddressList(get("from"))[0];
  const inReplyTo = get("in-reply-to");
  const references = (get("references") ?? "").match(/<[^<>\s]+>/g) ?? [];
  const wasShown = cidsIn(kept.html);
  const files = input.attachments
    ? await attachmentsOf(deps, input.attachments)
    : (await originalAttachments(deps, msg)).filter((a) => !shownIn(wasShown, a));
  const attachments = withinGuard([...(await shownImages(deps, msg, bodies.html)), ...files]);

  const raw = buildMime(
    {
      ...(from ? { from } : {}),
      to: input.to ? recipients(input.to, "to") : parseAddressList(get("to")),
      cc: input.cc ? recipients(input.cc, "cc") : parseAddressList(get("cc")),
      bcc: input.bcc ? recipients(input.bcc, "bcc") : parseAddressList(get("bcc")),
      subject: input.subject ?? get("subject") ?? "",
      ...bodies,
      attachments,
      ...(inReplyTo ? { inReplyTo } : {}),
      references,
    },
    deps.boundary,
  );
  // Only a reply names its thread: a standalone draft is alone in its own, and
  // there is nothing to keep it in.
  return {
    ...draftResult(deps, id, await deps.write.updateDraft(draftId, raw, inReplyTo ? (msg.threadId ?? undefined) : undefined)),
    ...attachmentFacts(attachments, bodies.html),
  };
};

export const getDraft = async (deps: Deps, draftId: string, detail: Detail) => {
  const [draft, id] = await Promise.all([
    deps.write.getDraft(draftId, detail === "metadata" ? "metadata" : "full"),
    identityOf(deps),
  ]);
  const msg = draft.message ?? {};
  const bcc = Object.entries(headersOf(msg.payload)).find(([k]) => k.toLowerCase() === "bcc")?.[1];
  return {
    ...draftResult(deps, id, draft),
    message: { ...messageView(msg, detail, deps.htmlToText), ...(bcc ? { bcc } : {}) },
  };
};

export const listDrafts = async (deps: Deps, q: { query?: string; maxResults: number; pageToken?: string }) => {
  const [page, id] = await Promise.all([deps.write.listDrafts(q), identityOf(deps)]);
  const drafts = await Promise.all(
    (page.drafts ?? []).map(async (d) => {
      const messageId = d.message?.id ?? "";
      const threadId = d.message?.threadId ?? "";
      const base = { draftId: d.id, messageId, threadId, webUrl: draftUrl(id.mailbox, threadId, messageId, d.id ?? "") };
      try {
        const m = messageView(
          await deps.gmail.getMessage(messageId, { format: "metadata", metadataHeaders: SUMMARY_HEADERS }),
          "metadata",
          deps.htmlToText,
        );
        return { ...base, to: m.to, cc: m.cc, subject: m.subject, date: m.date, snippet: m.snippet };
      } catch {
        return { ...base, partial: true };
      }
    }),
  );
  return { account: deps.account, drafts, nextPageToken: page.nextPageToken, resultSizeEstimate: page.resultSizeEstimate };
};

export const deleteDraft = async (deps: Deps, draftId: string) => {
  await requireWrite(deps);
  await deps.write.deleteDraft(draftId);
  return { account: deps.account, deleted: true, draftId };
};

/** Outward-facing. The controller's description says the user has to have said so. */
export const sendDraft = async (deps: Deps, draftId: string) => {
  await requireWrite(deps);
  // Everything that can fail is read BEFORE the send, never beside it: a send
  // that succeeded while a parallel lookup failed would report an error for a
  // mail that is already gone.
  const id = await identityOf(deps);
  return sentResult(deps, id, await deps.write.sendDraft(draftId));
};
