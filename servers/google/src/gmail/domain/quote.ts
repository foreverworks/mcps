/**
 * The quoted original under a reply and the forwarded block under a forward,
 * in the markup Gmail's own Reply and Forward write (checked against drafts
 * Gmail itself made), so they read as Gmail's own. Pure.
 *
 * What makes Gmail fold a quote behind "•••" in its conversation view is not
 * this markup: Gmail hides the part of a message that repeats an earlier one
 * in the conversation. Restyled markup still counts as a repeat; a quote that
 * lost the original's images does not, and is shown in full. That is why a
 * reply also carries the original's inline images (shownImages, cidsIn).
 * With conversation view off nothing folds, Gmail's own replies included.
 */
import { type Address, parseAddressList } from "./addresses.js";
import { decodePartData, type MimePart, walkParts } from "./mime.js";
import type { Original } from "./threading.js";

/** What quoting needs besides the messages: an HTML-to-text converter and the zone dates are written in. */
export type QuoteContext = {
  readonly htmlToText: (h: string) => string;
  /** The IANA zone of the people reading, which is the zone Gmail writes the attribution in. */
  readonly timeZone: string;
};

export type Bodies = { readonly text?: string; readonly html?: string };

/**
 * Both bodies of a message, whole. Unlike what get_message shows, nothing is
 * truncated: a quote or a forward that silently lost its tail would be worse
 * than none.
 */
export const fullBodies = (payload: MimePart | undefined): Bodies => {
  const first = (type: string) => {
    for (const part of walkParts(payload ?? {})) {
      if (part.mimeType !== type || part.filename || part.body?.data == null) continue;
      const decoded = decodePartData(part.body.data);
      if (decoded !== undefined) return decoded;
    }
    return undefined;
  };
  const text = first("text/plain");
  const html = first("text/html");
  return { ...(text !== undefined ? { text } : {}), ...(html !== undefined ? { html } : {}) };
};

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text as HTML that keeps its line breaks. */
export const textToHtml = (s: string): string => escapeHtml(s).replace(/\r?\n/g, "<br>\n");

/**
 * The HTML alternative of a body written as plain text, in the wrapper Gmail's
 * own compose uses. Without it a message is text/plain alone, and Gmail opens
 * such a draft in plain-text mode, which hard-wraps every paragraph at about
 * 72 columns when the user presses Send: the recipient then reads a
 * fixed-width block that looks pasted from a terminal.
 */
export const plainTextAsHtml = (s: string): string => `<div dir="ltr">${textToHtml(s)}</div>`;

/**
 * The original as text, for the plain-text quote. An original with HTML is
 * converted from its HTML rather than taken from its own text/plain part:
 * senders that build mail from a template often ship a text part that is the
 * HTML with its tags deleted (a typical order confirmation: dozens of empty
 * lines per layout table and a literal "&copy;"), and quoting that verbatim is what put
 * a column of bare ">" lines under a reply. Runs of blank lines collapse to one.
 */
const originalText = (original: Bodies, htmlToText: (h: string) => string): string =>
  (original.html !== undefined ? htmlToText(original.html) : (original.text ?? ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

/**
 * A date as Gmail writes it in an attribution and a forward's header, in the
 * reader's zone: "Tue, Jan 15, 2030 at 9:41\u202fPM", narrow no-break space
 * before the AM/PM as Gmail has it. A Date header that does not parse is kept
 * as it came rather than dropped.
 */
export const gmailDate = (header: string | undefined, timeZone: string): string | undefined => {
  if (!header?.trim()) return undefined;
  const at = Date.parse(header.replace(/\([^()]*\)\s*$/, "").trim());
  if (Number.isNaN(at)) return header.trim();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(at));
  const p = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? "";
  return `${p("weekday")}, ${p("month")} ${p("day")}, ${p("year")} at ${p("hour")}:${p("minute")}\u202f${p("dayPeriod")}`;
};

type Line = { readonly text: string; readonly html: string };

/** A person as Gmail's attribution writes one: `Name <address>`, the address a mailto link in the HTML. */
const person = (a: Address): Line => {
  const link = `&lt;<a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a>&gt;`;
  return a.name ? { text: `${a.name} <${a.email}>`, html: `${escapeHtml(a.name)} ${link}` } : { text: `<${a.email}>`, html: link };
};

/** An address header's people, or the header as it came when it holds no address. */
const people = (value: string): Line => {
  const list = parseAddressList(value);
  if (list.length === 0) return { text: value, html: escapeHtml(value) };
  const lines = list.map(person);
  return { text: lines.map((l) => l.text).join(", "), html: lines.map((l) => l.html).join(", ") };
};

/** "On Tue, Jan 15, 2030 at 9:41 PM Name <address> wrote:", Gmail's words. */
const attribution = (orig: Original, timeZone: string): Line => {
  const when = gmailDate(orig.date, timeZone);
  const who = orig.from ? people(orig.from) : { text: "the sender", html: "the sender" };
  return when
    ? { text: `On ${when} ${who.text} wrote:`, html: `On ${escapeHtml(when)} ${who.html} wrote:` }
    : { text: `${who.text} wrote:`, html: `${who.html} wrote:` };
};

const QUOTE_STYLE = "margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex";

/**
 * Returns the new body with the original quoted below it, for whichever body
 * types the reply has. The original's HTML goes in whole, as it arrived: its
 * markup is what Gmail matches against the earlier message to fold the quote,
 * and an Outlook recipient keeps the styles its own client wrote.
 */
export const withQuote = (reply: Bodies, orig: Original, original: Bodies, ctx: QuoteContext): Bodies => {
  const origText = originalText(original, ctx.htmlToText);
  const origHtml = original.html ?? textToHtml(origText);
  const attr = attribution(orig, ctx.timeZone);
  const quotedText = origText
    .split("\n")
    .map((line) => (line === "" ? ">" : line.startsWith(">") ? `>${line}` : `> ${line}`))
    .join("\n");
  return {
    ...(reply.text !== undefined ? { text: `${reply.text}\n\n${attr.text}\n\n${quotedText}\n` } : {}),
    ...(reply.html !== undefined
      ? {
          html:
            `${reply.html}<br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">${attr.html}<br></div>` +
            `<blockquote class="gmail_quote" style="${QUOTE_STYLE}">${origHtml}</blockquote></div>`,
        }
      : {}),
  };
};

/** The sender as Gmail's forward header writes it: the name in bold, the address linked. */
const sender = (from: string): Line => {
  const a = parseAddressList(from)[0];
  if (!a) return { text: from, html: escapeHtml(from) };
  const link = `<span dir="auto">${person({ email: a.email }).html}</span>`;
  return {
    text: person(a).text,
    html: a.name ? `<strong class="gmail_sendername" dir="auto">${escapeHtml(a.name)}</strong> ${link}` : link,
  };
};

const forwardHeaderLines = (orig: Original, timeZone: string): readonly (readonly [string, Line])[] => {
  const date = gmailDate(orig.date, timeZone);
  const pairs: readonly (readonly [string, Line | undefined])[] = [
    ["From", orig.from ? sender(orig.from) : undefined],
    ["Date", date ? { text: date, html: escapeHtml(date) } : undefined],
    ["Subject", orig.subject ? { text: orig.subject, html: escapeHtml(orig.subject) } : undefined],
    ["To", orig.to ? people(orig.to) : undefined],
    ["Cc", orig.cc ? people(orig.cc) : undefined],
  ];
  return pairs.flatMap(([k, v]) => (v ? [[k, v] as const] : []));
};

/** The note (if any), then Gmail's "Forwarded message" block and the original body. */
export const withForwarded = (note: Bodies, orig: Original, original: Bodies, ctx: QuoteContext): Bodies => {
  const origText = originalText(original, ctx.htmlToText);
  const origHtml = original.html ?? textToHtml(origText);
  const lines = forwardHeaderLines(orig, ctx.timeZone);
  const textBlock = ["---------- Forwarded message ---------", ...lines.map(([k, v]) => `${k}: ${v.text}`), "", "", origText].join("\n");
  const htmlBlock =
    `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>` +
    lines.map(([k, v]) => `${k}: ${v.html}<br>`).join("") +
    `</div><br><br>${origHtml}</div>`;
  // A forward always carries both bodies: the original may be HTML-only, and
  // dropping it to text would lose its formatting for the recipient.
  const noteText = note.text ?? (note.html !== undefined ? ctx.htmlToText(note.html) : "");
  const noteHtml = note.html ?? (note.text ? plainTextAsHtml(note.text) : "");
  return {
    text: noteText ? `${noteText}\n\n${textBlock}` : textBlock,
    html: noteHtml ? `${noteHtml}<br><br>${htmlBlock}` : htmlBlock,
  };
};
