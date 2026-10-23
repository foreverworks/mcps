/**
 * Gmail web links. Pure.
 *
 * Measured against real Gmail rather than copied,
 * because the obvious copy was wrong: Google's own Gmail MCP server returns
 * drafts as `#all?compose=thread-f:<thread>+msg-a:<draft>`, and that opened an
 * EMPTY compose window for every draft this server made, standalone or reply.
 * What Gmail itself puts in the address bar when you open a draft is an opaque
 * token (`compose=JHrtff...`), and that token turned out to be the legacy id
 * string re-encoded (see gmailToken). Emitting the token opens the draft.
 *
 * And the id string inside it DIFFERS by kind of account, measured on fresh
 * drafts in one mailbox of each kind, each form tried in each:
 *   consumer Gmail (gmail.com)   f:<thread>|msg-a:<draft>+msg-a:<draft>
 *   Google Workspace             f:<thread>+msg-a:<draft>
 * Each form opens an empty compose window in the other kind of account. The
 * Workspace form is the one Google's own server writes, which is why its links
 * work for a Workspace mailbox.
 *
 * A reply draft has no compose link at all: Gmail keeps it inline at the foot
 * of its conversation, so its link is the conversation.
 *
 * `authuser=<address>` rather than `/u/0/`: the index depends on the order the
 * accounts were signed into a browser, and differs between browsers; the
 * address does not.
 */
const BASE = "https://mail.google.com/mail/";

/** Gmail's web ids are the API's hex ids, written in decimal. */
const decimal = (hexId: string): string => {
  try {
    return BigInt(`0x${hexId}`).toString(10);
  } catch {
    return hexId;
  }
};

const base = (address: string | undefined) => (address ? `${BASE}?authuser=${address}` : BASE);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const GMAIL = "BCDFGHJKLMNPQRSTVWXZbcdfghjklmnpqrstvwxz";

/**
 * Gmail's opaque web id (`FMfcgz...`, `JHrtff...`): the legacy id string,
 * base64-encoded, read as one number in base 64 and written out again in
 * base 40 over consonants. Proved against three tokens Gmail produced itself,
 * not inferred; test/gmail/webUrl.test.ts pins it with invented ids.
 */
export const gmailToken = (legacy: string): string => {
  let n = 0n;
  for (const ch of Buffer.from(legacy, "utf8").toString("base64").replace(/=+$/, "")) n = n * 64n + BigInt(B64.indexOf(ch));
  let out = "";
  while (n > 0n) {
    out = (GMAIL[Number(n % 40n)] as string) + out;
    n /= 40n;
  }
  return out;
};

export const messageUrl = (address: string | undefined, threadId: string, messageId: string): string =>
  `${base(address)}#all/thread-f:${decimal(threadId)}|msg-f:${decimal(messageId)}`;

export const threadUrl = (address: string | undefined, threadId: string): string =>
  `${base(address)}#all/thread-f:${decimal(threadId)}`;

const CONSUMER = /@(gmail|googlemail)\.com$/i;

/**
 * A draft alone in its thread opens in the compose window; a draft in a
 * conversation with other messages (a reply) is shown inline in it.
 */
export const draftUrl = (address: string | undefined, threadId: string, messageId: string, draftId: string): string => {
  if (threadId && messageId && threadId !== messageId) return threadUrl(address, threadId);
  const t = decimal(threadId);
  const legacy = CONSUMER.test(address ?? "") ? `f:${t}|msg-a:${draftId}+msg-a:${draftId}` : `f:${t}+msg-a:${draftId}`;
  return `${base(address)}#all?compose=${gmailToken(legacy)}`;
};
