/**
 * What every composing use case shares: turning a caller's recipients,
 * bodies, attachments and From into an Outgoing message, and the links that
 * come back. The rules themselves are in domain/; this is the part that needs
 * the ports (the send-as list, the files, the original's attachment bytes).
 */
import { basename } from "node:path";

import { sha256Of } from "@foreverworks/mcp-kit";

import { type Address, parseAddressList, sameEmail } from "../../domain/addresses.js";
import { attachmentsSize, bareCid, cidsIn, MAX_ATTACHMENTS_BYTES, type OutgoingAttachment, mimeTypeFor, shownIn } from "../../domain/compose.js";
import { inputError, fail } from "../../domain/errors.js";
import { type MimePart, walkParts } from "../../domain/mime.js";
import { type Bodies, plainTextAsHtml } from "../../domain/quote.js";
import type { RawMessage } from "../../domain/summaries.js";
import { draftUrl, messageUrl } from "../../domain/webUrl.js";
import type { Deps, RawDraft, SendAs } from "../ports.js";

export type AttachmentInput = {
  readonly path?: string;
  readonly contentBase64?: string;
  /** Hex SHA-256 of the source file: required with contentBase64, checked with path. */
  readonly sha256?: string;
  readonly filename?: string;
  readonly mimeType?: string;
};

export type ComposeInput = {
  readonly to?: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject?: string;
  readonly bodyText?: string;
  readonly bodyHtml?: string;
  readonly attachments?: readonly AttachmentInput[];
  /** A send-as address of this account, optionally with a display name. */
  readonly from?: string;
};

/** Each entry may itself be a list ("A <a@x>, b@y"). One that holds no address is an error, not a silent drop. */
export const recipients = (entries: readonly string[] | undefined, field: string): readonly Address[] =>
  (entries ?? []).flatMap((entry) => {
    const parsed = parseAddressList(entry);
    return parsed.length ? parsed : fail(inputError(`${field}: "${entry}" is not an email address`));
  });

/**
 * The bodies a message goes out with, always both when there is anything to
 * say. HTML alone gets a plain-text alternative converted from it: mail with no
 * text part reads as spam to several filters and as nothing at all to a
 * text-only client. Text alone gets an HTML alternative with the same lines
 * (see plainTextAsHtml): a text/plain-only draft is rewrapped to fixed-width
 * lines by Gmail when the user sends it from the Gmail UI.
 */
export const bodiesOf = (deps: Deps, input: { readonly bodyText?: string; readonly bodyHtml?: string }): Bodies => {
  if (input.bodyHtml !== undefined) {
    return { text: input.bodyText ?? deps.htmlToText(input.bodyHtml), html: input.bodyHtml };
  }
  return input.bodyText ? { text: input.bodyText, html: plainTextAsHtml(input.bodyText) } : { text: input.bodyText ?? "" };
};

/**
 * The caller's files, byte-exact (mcp-kit's input-file reader): by path from
 * the server's file roots, or base64 that must hash to the sha256 the caller
 * sent. Any refusal (a link, a file outside the roots, a checksum that does not
 * match) fails the whole call before anything reaches Gmail.
 */
export const attachmentsOf = async (deps: Deps, inputs: readonly AttachmentInput[] | undefined): Promise<OutgoingAttachment[]> =>
  Promise.all(
    (inputs ?? []).map(async (a): Promise<OutgoingAttachment> => {
      if (a.contentBase64 !== undefined && !a.path && !a.filename) {
        return fail(inputError("an attachment given as content_base64 needs a filename"));
      }
      const file = await deps.files.readInput({ path: a.path, contentBase64: a.contentBase64, sha256: a.sha256, name: a.filename });
      const filename = basename(file.name);
      return { filename, mimeType: a.mimeType || mimeTypeFor(filename), data: file.bytes };
    }),
  );

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/**
 * A message's attachments, carried and new, refused together over the guard
 * (domain/compose.ts) before anything is encoded or reaches Gmail.
 */
export const withinGuard = (attachments: OutgoingAttachment[]): OutgoingAttachment[] => {
  const total = attachmentsSize(attachments);
  if (total <= MAX_ATTACHMENTS_BYTES) return attachments;
  return fail(
    inputError(
      `the attachments come to ${mb(total)} MiB together, over this server's ${mb(MAX_ATTACHMENTS_BYTES)} MiB guard (Gmail itself takes 25 MB): share large files as a Drive link instead`,
    ),
  );
};

/**
 * What went out with the message, so the caller can check it against the
 * source: each file's name, size and sha256. Absent when nothing was attached.
 * The images the body shows (a quoted original's logos) are counted apart:
 * they belong to the quote, not to anything the caller attached.
 */
export const attachmentFacts = (attachments: readonly OutgoingAttachment[], html?: string) => {
  const cids = cidsIn(html);
  const files = attachments.filter((a) => !shownIn(cids, a));
  const inline = attachments.length - files.length;
  return {
    ...(files.length ? { attachments: files.map((a) => ({ filename: a.filename, size: a.data.length, sha256: sha256Of(a.data) })) } : {}),
    ...(inline ? { inlineImages: inline } : {}),
  };
};

const contentIdOf = (p: MimePart): string | undefined => p.headers?.find((h) => h.name?.toLowerCase() === "content-id")?.value ?? undefined;

/**
 * The parts of a message that `keep` picks, with their bytes. A small one
 * arrives inline in the part (`body.data`) rather than behind an attachment id,
 * which is why this does not reuse the read path's list: that list is built for
 * showing ids, and would silently drop the inline ones.
 */
const partsWithBytes = async (deps: Deps, msg: RawMessage, keep: (p: MimePart) => boolean): Promise<OutgoingAttachment[]> => {
  const parts = [...walkParts(msg.payload ?? {})].filter(
    (p) => !p.parts?.length && (p.body?.attachmentId != null || p.body?.data != null) && keep(p),
  );
  return Promise.all(
    parts.map(async (p) => {
      const data = p.body?.attachmentId
        ? await deps.gmail.getAttachment(msg.id as string, p.body.attachmentId)
        : Buffer.from(p.body?.data ?? "", "base64url");
      const filename = p.filename ?? "";
      const contentId = contentIdOf(p);
      return { filename, mimeType: p.mimeType || mimeTypeFor(filename), data, ...(contentId ? { contentId } : {}) };
    }),
  );
};

/** Every real attachment of a message (a part with a file name), with its bytes. */
export const originalAttachments = (deps: Deps, msg: RawMessage): Promise<OutgoingAttachment[]> => partsWithBytes(deps, msg, (p) => !!p.filename);

/**
 * The images a message's parts hold that `html` shows by `cid:`, file name or
 * not: a quote or a forward of an HTML original carries them, as Gmail's own
 * Reply does. Without them the quote's images point nowhere: a broken image in
 * the draft, nothing for the recipient, and a client that drops them on Send
 * leaves a quote Gmail no longer recognises as the earlier message, so it is
 * shown in full instead of folded behind "•••".
 */
export const shownImages = (deps: Deps, msg: RawMessage, html: string | undefined): Promise<OutgoingAttachment[]> => {
  const cids = cidsIn(html);
  if (cids.size === 0) return Promise.resolve([]);
  return partsWithBytes(deps, msg, (p) => {
    const id = contentIdOf(p);
    return id !== undefined && cids.has(bareCid(id));
  });
};

export type Identity = {
  readonly aliases: readonly SendAs[];
  /** Every address that is this account's own: its send-as list and its login. */
  readonly mine: readonly string[];
  /** The mailbox address, for `authuser=` in the web links. */
  readonly mailbox: string | undefined;
};

export const identityOf = async (deps: Deps): Promise<Identity> => {
  const aliases = ((await deps.write.sendAs()).sendAs ?? []).filter(
    (a) => a.sendAsEmail && (a.isPrimary || a.verificationStatus === undefined || a.verificationStatus === "accepted"),
  );
  const primary = aliases.find((a) => a.isPrimary)?.sendAsEmail;
  const mailbox = deps.address ?? primary ?? (await deps.gmail.profile()).emailAddress ?? undefined;
  const mine = [...new Set([...aliases.flatMap((a) => (a.sendAsEmail ? [a.sendAsEmail] : [])), ...(mailbox ? [mailbox] : [])])];
  return { aliases, mine, mailbox };
};

/**
 * The From header, or none.
 *
 * - An explicit `from` must be one of the account's verified send-as
 *   addresses; anything else is refused with the list, because Gmail would
 *   otherwise rewrite it silently to the default.
 * - Without one, `preferred` (the alias a reply's original reached) wins, then
 *   the account's default alias.
 * - The primary address with no display name of its own gets NO From header:
 *   Gmail then writes the Google account's name, which is what the user's
 *   hand-sent mail carries. Writing a bare address would be a visible downgrade.
 */
export const fromOf = (id: Identity, requested: string | undefined, preferred?: string): Address | undefined => {
  if (requested) {
    const wanted = parseAddressList(requested)[0];
    const alias = wanted && id.aliases.find((a) => sameEmail(a.sendAsEmail as string, wanted.email));
    if (!wanted || !alias) {
      return fail(inputError(`from "${requested}" is not a send-as address of this account; it has: ${id.aliases.map((a) => a.sendAsEmail).join(", ")}`));
    }
    const name = wanted.name || alias.displayName;
    return name ? { name, email: alias.sendAsEmail as string } : { email: alias.sendAsEmail as string };
  }
  const alias =
    (preferred ? id.aliases.find((a) => sameEmail(a.sendAsEmail as string, preferred)) : undefined) ??
    id.aliases.find((a) => a.isDefault);
  if (!alias || (alias.isPrimary && !alias.displayName)) return undefined;
  return alias.displayName ? { name: alias.displayName, email: alias.sendAsEmail as string } : { email: alias.sendAsEmail as string };
};

export const draftResult = (deps: Deps, id: Identity, draft: RawDraft) => {
  const threadId = draft.message?.threadId ?? "";
  return {
    account: deps.account,
    draftId: draft.id,
    messageId: draft.message?.id,
    threadId: draft.message?.threadId,
    webUrl: draftUrl(id.mailbox, threadId, draft.message?.id ?? "", draft.id ?? ""),
  };
};

export const sentResult = (deps: Deps, id: Identity, msg: RawMessage) => ({
  account: deps.account,
  sent: true,
  messageId: msg.id,
  threadId: msg.threadId,
  labelIds: msg.labelIds ?? [],
  webUrl: messageUrl(id.mailbox, msg.threadId ?? "", msg.id ?? ""),
});
