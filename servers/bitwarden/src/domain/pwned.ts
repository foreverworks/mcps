/**
 * Have I Been Pwned's Pwned Passwords range API, by k-anonymity: the SHA-1
 * of a password, upper-case hex, is split after five characters; only those
 * five leave the server, and the answer lists every suffix of that range with
 * how often it was seen in breaches. The password, its full hash, and which
 * suffix was looked for stay here. Pure: the hash arrives as hex.
 */
import { cliError, fail } from "./errors.js";

/** The five characters that are sent, and the thirty-five that are not. */
export const rangeOf = (sha1Hex: string): { readonly prefix: string; readonly suffix: string } => {
  const hex = sha1Hex.toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(hex)) return fail(cliError("a SHA-1 is 40 hex characters"));
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
};

/**
 * How often `suffix` was seen, from a range answer (`SUFFIX:COUNT` per line).
 * Padding lines (count 0, sent so an answer's size gives nothing away) read as
 * not seen. `undefined` when the answer is not a range answer at all.
 */
export const countIn = (body: string, suffix: string): number | undefined => {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  let count = 0;
  for (const line of lines) {
    const match = /^([0-9A-F]{35}):(\d+)$/i.exec(line.trim());
    if (match === null) return undefined;
    if ((match[1] as string).toUpperCase() === suffix) count = Number(match[2]);
  }
  return count;
};
