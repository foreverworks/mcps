/**
 * Mail addresses: parsing the lists Gmail hands back, and writing the ones we
 * send. Pure, and deliberately small: it handles what real headers carry
 * (display names, quoted names with commas, bare addresses), not every corner
 * of RFC 5322's grammar.
 */
import { encodeWords, isAscii } from "./headerText.js";

export type Address = { readonly name?: string; readonly email: string };

/** Split on the commas that separate addresses, not the ones inside a quoted name or <...>. */
const splitList = (value: string): string[] => {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i] as string;
    if (c === "\\" && quoted) {
      current += c + (value[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (c === "<" && !quoted) angle = true;
    else if (c === ">" && !quoted) angle = false;
    if ((c === "," || c === ";") && !quoted && !angle) {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
};

const unquote = (name: string): string => {
  const t = name.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1).replace(/\\(.)/g, "$1") : t;
};

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+$/;

export const isEmail = (s: string): boolean => EMAIL.test(s);

/**
 * `Ana Popescu <ana@example.com>, "Doe, Jane" <jane@example.org>, plain@example.net` -> three addresses.
 * An entry with no recognisable address is dropped rather than guessed at.
 */
export const parseAddressList = (value: string | undefined): readonly Address[] =>
  splitList(value ?? "").flatMap((entry): Address[] => {
    const m = /^(.*?)<([^<>]+)>\s*$/.exec(entry);
    if (m) {
      const email = (m[2] as string).trim();
      const name = unquote(m[1] as string);
      return isEmail(email) ? [name ? { name, email } : { email }] : [];
    }
    const bare = entry.replace(/\(.*?\)/g, "").trim();
    return isEmail(bare) ? [{ email: bare }] : [];
  });

export const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** First occurrence wins, compared case-insensitively on the address alone. */
export const dedupe = (list: readonly Address[], exclude: readonly string[] = []): readonly Address[] => {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  return list.filter((a) => {
    const key = a.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const SPECIALS = /[()<>@,;:\\".[\]]/;
const ENCODED_WORD = /=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=/;

/**
 * One address as a header writes it. A non-ASCII display name becomes RFC 2047
 * encoded words; an ASCII one is quoted only when it has to be. A name that is
 * ALREADY encoded (Gmail sometimes hands headers back that way) is passed
 * through: quoting an encoded word stops it being decoded.
 */
export const formatAddress = (a: Address): string => {
  const name = a.name?.replace(/[\r\n]+/g, " ").trim();
  if (!name) return a.email;
  if (!isAscii(name)) return `${encodeWords(name).join(" ")} <${a.email}>`;
  if (ENCODED_WORD.test(name)) return `${name} <${a.email}>`;
  if (SPECIALS.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}" <${a.email}>`;
  return `${name} <${a.email}>`;
};

export const formatAddressList = (list: readonly Address[]): string => list.map(formatAddress).join(", ");
