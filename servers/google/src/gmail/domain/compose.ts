/**
 * An outgoing message, and the RFC 5322 bytes Gmail is handed for it. Pure:
 * the boundary generator is an argument, so a test can pin the output.
 */
import { type Address, formatAddressList } from "./addresses.js";
import { base64Lines, crlf, encodeText, header, isAscii, oneLine } from "./headerText.js";

export { mimeTypeFor } from "../../domain/mimeTypes.js";

export type OutgoingAttachment = {
  /** May be empty: an inline image often has none. */
  readonly filename: string;
  readonly mimeType: string;
  readonly data: Buffer;
  /** Kept from the original, so an HTML body's cid: references still resolve. */
  readonly contentId?: string;
};

/** A Content-ID as a `cid:` URL names it: no angle brackets, URL-decoded. */
export const bareCid = (id: string): string => {
  const bare = id.trim().replace(/^<([^<>]*)>$/, "$1");
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
};

/** The Content-IDs an HTML body shows by `cid:` URL (an <img src>, a CSS url()), bare. */
export const cidsIn = (html: string | undefined): ReadonlySet<string> =>
  new Set([...(html ?? "").matchAll(/\bcid:([^"'\s)>]+)/gi)].map((m) => bareCid(m[1] as string)));

/** Whether an attachment is one of the images an HTML body shows, by its Content-ID. */
export const shownIn = (cids: ReadonlySet<string>, a: OutgoingAttachment): boolean =>
  a.contentId !== undefined && cids.has(bareCid(a.contentId));

export type Outgoing = {
  readonly from?: Address;
  readonly to: readonly Address[];
  readonly cc: readonly Address[];
  readonly bcc: readonly Address[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments: readonly OutgoingAttachment[];
  /** The Message-ID being answered, angle brackets included. */
  readonly inReplyTo?: string;
  readonly references: readonly string[];
};

export type Boundary = () => string;

const textPart = (subtype: "plain" | "html", body: string): string =>
  [
    `Content-Type: text/${subtype}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(crlf(body), "utf8")),
  ].join("\r\n");

/** A quoted-string parameter value, or RFC 2231's extended form when it is not ASCII. */
const param = (key: string, value: string): string => {
  const clean = oneLine(value).replace(/["\\]/g, "_");
  if (isAscii(clean)) return `${key}="${clean}"`;
  const fallback = clean.replace(/[^\x20-\x7e]/g, "_");
  return `${key}="${fallback}"; ${key}*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
};

const filePart = (a: OutgoingAttachment, disposition: "attachment" | "inline"): string =>
  [
    `Content-Type: ${oneLine(a.mimeType) || "application/octet-stream"}${a.filename ? `; ${param("name", a.filename)}` : ""}`,
    `Content-Disposition: ${disposition}${a.filename ? `; ${param("filename", a.filename)}` : ""}`,
    ...(a.contentId ? [`Content-ID: ${oneLine(a.contentId)}`] : []),
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(a.data),
  ].join("\r\n");

const multipart = (subtype: string, parts: readonly string[], boundary: string): string =>
  [
    `Content-Type: multipart/${subtype}; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");

/**
 * The body as MIME: one part when there is one body, multipart/alternative
 * when there are two. The images the HTML shows by `cid:` (a quoted or
 * forwarded original's logos and signatures) go beside it in multipart/related,
 * as Gmail's own Reply sends them, so they resolve in the draft and for every
 * recipient. Everything else attached wraps it all in multipart/mixed.
 */
const bodyOf = (m: Outgoing, boundary: Boundary): string => {
  const bodies = [
    ...(m.text !== undefined ? [textPart("plain", m.text)] : []),
    ...(m.html !== undefined ? [textPart("html", m.html)] : []),
  ];
  const main = bodies.length === 2 ? multipart("alternative", bodies, boundary()) : (bodies[0] ?? textPart("plain", ""));
  const cids = cidsIn(m.html);
  const inline = m.attachments.filter((a) => shownIn(cids, a));
  const files = m.attachments.filter((a) => !shownIn(cids, a));
  const related = inline.length === 0 ? main : multipart("related", [main, ...inline.map((a) => filePart(a, "inline"))], boundary());
  return files.length === 0 ? related : multipart("mixed", [related, ...files.map((a) => filePart(a, "attachment"))], boundary());
};

export const buildMime = (m: Outgoing, boundary: Boundary): string => {
  const headers = [
    ...(m.from ? [header("From", formatAddressList([m.from]))] : []),
    ...(m.to.length ? [header("To", formatAddressList(m.to))] : []),
    ...(m.cc.length ? [header("Cc", formatAddressList(m.cc))] : []),
    // Gmail strips Bcc before delivery and keeps it on a draft, which is what
    // makes a draft with Bcc recipients reopen with them still there.
    ...(m.bcc.length ? [header("Bcc", formatAddressList(m.bcc))] : []),
    header("Subject", encodeText(m.subject)),
    ...(m.inReplyTo ? [header("In-Reply-To", m.inReplyTo)] : []),
    ...(m.references.length ? [header("References", m.references.join(" "))] : []),
    "MIME-Version: 1.0",
  ];
  return `${headers.join("\r\n")}\r\n${bodyOf(m, boundary)}`;
};



/**
 * The most this server attaches to one message, in all: above Gmail's own
 * 25 MB, so a message just over Gmail's limit is refused by Gmail in its own
 * words, while nothing far beyond it is ever encoded and uploaded. Also each
 * input file's cap.
 */
export const MAX_ATTACHMENTS_BYTES = 30 * 1024 * 1024;

/** Every attachment's bytes together. */
export const attachmentsSize = (attachments: readonly OutgoingAttachment[]): number =>
  attachments.reduce((total, a) => total + a.data.length, 0);

