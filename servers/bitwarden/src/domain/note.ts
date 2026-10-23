/**
 * A secure note: a secret that is not a password (a service account's key
 * file, an API token, a licence) kept in a hidden custom field, where get_field
 * hands it out and get_login names it without its value. Pure.
 *
 * Bitwarden limits what it stores by the length of the ENCRYPTED text, not the
 * plain one: the server refuses a custom field's value over 5,000 characters
 * and a note's text over 10,000 once encrypted ("exceeds the maximum encrypted
 * value length"). The CLI encrypts as type 2, AES-256-CBC with an HMAC-SHA256,
 * written `2.<iv>|<data>|<mac>` in base64: 16 bytes of IV, the text padded to a
 * whole 16-byte block (always at least one byte of padding), 32 bytes of MAC.
 * So the limit in plain UTF-8 bytes is computed here, and a value over it is
 * refused before anything is sent, with the reason, instead of failing in the
 * CLI after the caller has waited for it.
 */

/** Bitwarden's limits on encrypted text, in characters (its API's request models). */
export const FIELD_VALUE_LIMIT = 5000;
export const NOTES_LIMIT = 10_000;

/** The length of `2.<iv>|<data>|<mac>` for a plain text of `bytes` UTF-8 bytes. */
export const encryptedLength = (bytes: number): number => {
  const data = 16 * (Math.floor(bytes / 16) + 1);
  const base64 = (n: number): number => 4 * Math.ceil(n / 3);
  return "2.".length + base64(16) + "|".length + base64(data) + "|".length + base64(32);
};

/** The most UTF-8 bytes whose encrypted form fits in `limit` characters. */
export const plainLimit = (limit: number): number => {
  let bytes = 0;
  while (encryptedLength(bytes + 16) <= limit) bytes += 16;
  while (encryptedLength(bytes + 1) <= limit) bytes += 1;
  return bytes;
};

/** 3,695 bytes: a service account's JSON key (about 2,300) fits, a 4,096-bit PEM private key (about 3,250) too. */
export const MAX_FIELD_BYTES = plainLimit(FIELD_VALUE_LIMIT);
/** 7,439 bytes. */
export const MAX_NOTES_BYTES = plainLimit(NOTES_LIMIT);

/** The largest file this server reads for any tool: nothing bigger fits in a field. */
export const MAX_INPUT_FILE_BYTES = 16 * 1024;

const UTF8 = new TextEncoder();
/** `ignoreBOM` keeps a leading byte-order mark, so the text is the file's bytes exactly. */
const UTF8_EXACT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const utf8Length = (text: string): number => UTF8.encode(text).length;

/**
 * A field's value from a file's bytes, exactly: every line, a final line ending
 * and a leading byte-order mark kept, so the stored text encodes back to the
 * very bytes read (and to the file's SHA-256). Or why it cannot be one.
 */
export const fieldFromFile = (bytes: Uint8Array): { readonly text: string } | { readonly refused: string } => {
  if (bytes.length === 0) return { refused: "the file is empty" };
  try {
    return { text: UTF8_EXACT.decode(bytes) };
  } catch {
    return { refused: "the file is not UTF-8 text; Bitwarden stores text, so encode a binary file first (base64 -w0)" };
  }
};

/** Why `text` will not fit in a custom field, or `undefined` when it does. */
export const fieldTooLong = (name: string, text: string): string | undefined => {
  const bytes = utf8Length(text);
  return bytes <= MAX_FIELD_BYTES
    ? undefined
    : `field ${name} is ${bytes} bytes; Bitwarden keeps at most ${MAX_FIELD_BYTES} in a custom field (${FIELD_VALUE_LIMIT} characters once encrypted)`;
};

/** Why `text` will not fit in a note's text, or `undefined` when it does. */
export const notesTooLong = (text: string): string | undefined => {
  const bytes = utf8Length(text);
  return bytes <= MAX_NOTES_BYTES
    ? undefined
    : `notes are ${bytes} bytes; Bitwarden keeps at most ${MAX_NOTES_BYTES} in a note's text (${NOTES_LIMIT} characters once encrypted)`;
};

/** The names used more than once, ignoring case and surrounding spaces, as get_field matches them. */
export const repeatedNames = (names: readonly string[]): readonly string[] => {
  const keys = names.map((n) => n.trim().toLowerCase());
  return [...new Set(names.filter((_, i) => keys.indexOf(keys[i]!) !== i).map((n) => n.trim()))];
};
