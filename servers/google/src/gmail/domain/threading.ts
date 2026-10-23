/**
 * What a reply or a forward takes from the message it answers. Pure.
 *
 * Threading is three things and Gmail needs all of them: the threadId on the
 * API call (which files it in the conversation in OUR mailbox), and the
 * In-Reply-To and References headers (which thread it in EVERYONE else's).
 * A reply with only the first looks threaded here and arrives as a new
 * conversation at the other end.
 */
import { type Address, dedupe, parseAddressList } from "./addresses.js";
import type { Header } from "./mime.js";

export type Original = {
  readonly id?: string;
  readonly threadId?: string;
  readonly from?: string;
  readonly replyTo?: string;
  readonly to?: string;
  readonly cc?: string;
  readonly deliveredTo?: string;
  readonly subject?: string;
  readonly date?: string;
  readonly messageId?: string;
  readonly references?: string;
  readonly inReplyTo?: string;
};

/** Header names are case-insensitive, and Gmail returns both `Message-ID` and `Message-Id`. */
export const originalOf = (
  msg: { readonly id?: string | null; readonly threadId?: string | null },
  headers: readonly Header[],
): Original => {
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;
  const all = (name: string) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value).join(", ");
  return {
    ...(msg.id ? { id: msg.id } : {}),
    ...(msg.threadId ? { threadId: msg.threadId } : {}),
    ...pick("from", get("from")),
    ...pick("replyTo", get("reply-to")),
    ...pick("to", get("to")),
    ...pick("cc", get("cc")),
    ...pick("deliveredTo", all("delivered-to") || undefined),
    ...pick("subject", get("subject")),
    ...pick("date", get("date")),
    ...pick("messageId", get("message-id")),
    ...pick("references", get("references")),
    ...pick("inReplyTo", get("in-reply-to")),
  };
};

const pick = <K extends string>(key: K, value: string | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: string };

const RE = /^\s*re\s*(\[\d+\])?\s*:/i;
const FWD = /^\s*(fwd?|fw)\s*:/i;

export const replySubject = (subject: string | undefined): string =>
  RE.test(subject ?? "") ? (subject as string).trim() : `Re: ${(subject ?? "").trim()}`.trimEnd();

export const forwardSubject = (subject: string | undefined): string =>
  FWD.test(subject ?? "") ? (subject as string).trim() : `Fwd: ${(subject ?? "").trim()}`.trimEnd();

const ids = (value: string | undefined): string[] => (value ?? "").match(/<[^<>\s]+>/g) ?? [];

/**
 * The chain a reply carries: the original's References (or, lacking those, its
 * In-Reply-To), then the original's own Message-ID.
 */
export const threadHeaders = (orig: Original): { readonly inReplyTo?: string; readonly references: readonly string[] } => {
  const own = ids(orig.messageId)[0];
  const chain = ids(orig.references).length ? ids(orig.references) : ids(orig.inReplyTo);
  const references = own && !chain.includes(own) ? [...chain, own] : chain;
  return { ...(own ? { inReplyTo: own } : {}), references };
};

/**
 * Who a reply goes to, the way Gmail's own Reply and Reply all decide it.
 *
 * - Reply-To wins over From when present: it is the sender saying where
 *   answers belong (a mailing list, a ticket system, a recruiter's shared box).
 * - A reply to a message WE sent goes to that message's recipients. Replying to
 *   ourselves is never the intent, and it is the common case for a follow-up.
 * - Reply all adds the original To and Cc, minus every address that is ours
 *   and minus anyone already in To.
 */
export const replyRecipients = (
  orig: Original,
  mine: readonly string[],
  replyAll: boolean,
): { readonly to: readonly Address[]; readonly cc: readonly Address[] } => {
  const isMine = (a: Address) => mine.some((m) => m.toLowerCase() === a.email.toLowerCase());
  const from = parseAddressList(orig.from);
  const fromMe = from.length > 0 && from.every(isMine);

  const primary = fromMe
    ? parseAddressList(orig.to)
    : parseAddressList(orig.replyTo).length
      ? parseAddressList(orig.replyTo)
      : from;
  const to = dedupe(primary.filter((a) => !isMine(a)));
  const finalTo = to.length ? to : from;

  const others = replyAll
    ? fromMe
      ? parseAddressList(orig.cc)
      : [...parseAddressList(orig.to), ...parseAddressList(orig.cc)]
    : [];
  const cc = dedupe(
    others.filter((a) => !isMine(a)),
    finalTo.map((a) => a.email),
  );
  return { to: finalTo, cc };
};

/**
 * Which of our addresses the original reached, so the reply goes out from the
 * alias it was sent to, as Gmail does by default. For a message we sent, that
 * is the alias we sent it from.
 */
export const addressedAlias = (orig: Original, mine: readonly string[]): string | undefined => {
  const reached = [
    ...parseAddressList(orig.from),
    ...parseAddressList(orig.to),
    ...parseAddressList(orig.cc),
    ...parseAddressList(orig.deliveredTo),
  ].map((a) => a.email.toLowerCase());
  const hit = reached.find((r) => mine.some((m) => m.toLowerCase() === r));
  return hit === undefined ? undefined : mine.find((m) => m.toLowerCase() === hit);
};
