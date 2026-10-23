/**
 * A new password, generated here so it never has to travel: the server makes
 * it, stores it, and the caller asks for it only when it types it somewhere.
 * Pure: the random source arrives as an argument (`crypto.randomInt` in
 * production), so a test can pin it.
 */

export type RandomInt = (maxExclusive: number) => number;
export type PasswordRules = { readonly length: number; readonly symbols: boolean };

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
/** Symbols every signup form we have met accepts; no quotes, backslashes or spaces. */
const SYMBOLS = "!@#$%^&*-_=+";

export const DEFAULT_RULES: PasswordRules = { length: 24, symbols: true };
export const MIN_LENGTH = 12;
export const MAX_LENGTH = 128;

/** The longest password this server stores, generated or given. */
export const MAX_GIVEN_LENGTH = 1000;

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * A password from a file's bytes: UTF-8, one line, with the line ending an
 * editor or `echo` adds taken off and nothing else touched; or the reason the
 * file is not one password.
 */
export const passwordFromFile = (bytes: Uint8Array): { readonly password: string } | { readonly refused: string } => {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return { refused: "the password file is not UTF-8 text" };
  }
  const password = text.replace(/^\uFEFF/, "").replace(/\r?\n$/, "");
  if (password === "") return { refused: "the password file is empty" };
  if (/[\r\n]/.test(password)) return { refused: "the password file holds more than one line" };
  if (password.length > MAX_GIVEN_LENGTH) return { refused: `the password file holds more than ${MAX_GIVEN_LENGTH} characters` };
  return { password };
};

/** One character from each class first (sites that demand "a digit and a symbol"), the rest from all of them, then shuffled. */
export const generatePassword = (rules: PasswordRules, randomInt: RandomInt): string => {
  const classes = rules.symbols ? [LOWER, UPPER, DIGITS, SYMBOLS] : [LOWER, UPPER, DIGITS];
  const all = classes.join("");
  const pick = (from: string): string => from[randomInt(from.length)] ?? "";
  const chars = [...classes.map(pick), ...Array.from({ length: rules.length - classes.length }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] ?? "", chars[i] ?? ""];
  }
  return chars.join("");
};
