/**
 * Header text, as RFC 5322 and 2047 want it on the wire. Pure.
 */

export const isAscii = (s: string): boolean => /^[\x20-\x7e]*$/.test(s);

/**
 * CR and LF end a header. Letting a caller's subject carry one is header
 * injection: "Hi\r\nBcc: someone@else" would add a recipient nobody asked for.
 * Every value that reaches a header passes through here first.
 */
export const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");

/** RFC 2047 caps an encoded word at 75 characters; "=?UTF-8?B?" + "?=" leaves 63, so 45 raw bytes. */
const WORD_BYTES = 45;

/**
 * Non-ASCII text as encoded words, split on CODE POINT boundaries: a word that
 * ended half way through a multi-byte character would decode to U+FFFD in
 * every client that splits them, which is most of them.
 */
export const encodeWords = (text: string): readonly string[] => {
  const words: string[] = [];
  let chunk = "";
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, "utf8") > WORD_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`);
};

/** Unstructured text (a subject): passed through when ASCII, encoded otherwise. */
export const encodeText = (text: string): string => {
  const clean = oneLine(text);
  return isAscii(clean) ? clean : encodeWords(clean).join(" ");
};

const MAX_LINE = 78;

/**
 * `Name: value`, folded at spaces so no line passes 78 characters where that is
 * possible. A References header in a long thread runs to thousands; RFC 5322's
 * hard limit is 998, and past it Gmail rejects the message.
 */
export const header = (name: string, value: string): string => {
  const tokens = oneLine(value).split(" ").filter((t) => t.length > 0);
  const lines: string[] = [];
  let line = `${name}:`;
  for (const token of tokens) {
    if (line.length + 1 + token.length > MAX_LINE && line.length > name.length + 1) {
      lines.push(line);
      line = ` ${token}`;
    } else {
      line += ` ${token}`;
    }
  }
  lines.push(line);
  return lines.join("\r\n");
};

/** base64, wrapped at 76 as MIME requires. */
export const base64Lines = (data: Buffer): string => (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

/** Text parts go out with CRLF line ends, as the canonical form of text/* requires. */
export const crlf = (text: string): string => text.replace(/\r?\n/g, "\r\n");
