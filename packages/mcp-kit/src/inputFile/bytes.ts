import { createHash } from "node:crypto";

/**
 * The pure half of taking a file as base64: a decoder that refuses anything
 * but the one canonical encoding of some bytes, and the hash it is checked
 * against. Node's own decoder skips characters it does not know and ignores
 * stray bits, so a mistyped string decodes to SOMETHING without complaint;
 * that leniency is what this replaces.
 */

const ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Standard base64 with its padding, whitespace anywhere allowed (a line-wrapped
 * `base64` output), and nothing else: no URL-safe alphabet, no missing padding,
 * no bits after the last byte. `undefined` when it is not that.
 */
export const decodeBase64Strict = (text: string): Buffer | undefined => {
  const compact = text.replace(/[\t\n\r ]+/g, "");
  if (compact.length % 4 !== 0 || !ALPHABET.test(compact)) return undefined;
  const bytes = Buffer.from(compact, "base64");
  return bytes.toString("base64") === compact ? bytes : undefined;
};

/** A SHA-256 as sha256sum prints it, lower-cased; `undefined` when it is not 64 hex characters. */
export const parseSha256 = (text: string): string | undefined => {
  const hex = text.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : undefined;
};

export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
