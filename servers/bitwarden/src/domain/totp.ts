/**
 * TOTP (RFC 6238) computed here rather than by `bw get totp`, which Bitwarden
 * reserves for Premium accounts; a free account stores the authenticator key
 * all the same. Pure: the HMAC arrives as an
 * argument, so this module imports nothing.
 */

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";
export type TotpSpec = { readonly secret: Uint8Array; readonly digits: number; readonly period: number; readonly algorithm: TotpAlgorithm };
export type Hmac = (algorithm: TotpAlgorithm, key: Uint8Array, message: Uint8Array) => Uint8Array;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, case-insensitive, spaces, dashes and padding ignored. `undefined` if it is not base32. */
export const base32Decode = (text: string): Uint8Array | undefined => {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (clean.length === 0) return undefined;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) return undefined;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
};

const ALGORITHMS: Readonly<Record<string, TotpAlgorithm>> = { SHA1: "SHA1", SHA256: "SHA256", SHA512: "SHA512" };

/** 80 bits, the shortest key sites hand out (RFC 4226 asks for 128 and recommends 160). */
const MIN_KEY_CHARS = 16;
/** The lengths a base32 encoding can have, modulo 8 (1, 3 and 6 encode no whole number of bytes). */
const BASE32_LENGTHS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7]);

/**
 * Why a NEW authenticator key would not be the one the site showed, or
 * `undefined` when it reads as one. Stricter than reading a stored key: only
 * spaces between groups and final `=` padding are forgiven; any other
 * character, a key under 16 characters, or a length no base32 encoding has is
 * refused, since each is a sign the key was mistyped or cut. The final proof is
 * the site accepting a code from it.
 */
export const newKeyProblem = (text: string): string | undefined => {
  const value = text.trim();
  const secret = value.toLowerCase().startsWith("otpauth://")
    ? (() => {
        try {
          const url = new URL(value);
          return url.host.toLowerCase() === "totp" ? (url.searchParams.get("secret") ?? "") : undefined;
        } catch {
          return undefined;
        }
      })()
    : value;
  if (secret === undefined) return "it is neither a base32 secret nor an otpauth://totp/ URI";
  const clean = secret.replace(/ +/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]*$/.test(clean)) return "it holds characters base32 does not use (only A-Z and 2-7, spaces between groups)";
  if (clean.length < MIN_KEY_CHARS) return `it is ${clean.length} characters; a key is at least ${MIN_KEY_CHARS}`;
  if (!BASE32_LENGTHS.has(clean.length % 8)) return `no base32 key is ${clean.length} characters long; one may be missing or doubled`;
  return parseTotp(value) === undefined ? "its digits, period or algorithm are not ones this server computes" : undefined;
};

/** Whether two stored keys make the same codes. */
export const sameKey = (a: string, b: string): boolean => {
  const x = parseTotp(a);
  const y = parseTotp(b);
  if (x === undefined || y === undefined) return a.trim() === b.trim();
  return (
    x.digits === y.digits &&
    x.period === y.period &&
    x.algorithm === y.algorithm &&
    x.secret.length === y.secret.length &&
    x.secret.every((byte, i) => byte === y.secret[i])
  );
};

/**
 * The stored authenticator key, in either form Bitwarden accepts: an
 * `otpauth://totp/...` URI (its digits, period and algorithm honoured) or a
 * bare base32 secret (6 digits, 30 s, SHA1). `undefined` for anything else,
 * including Steam's `steam://` codes, which use their own alphabet.
 */
export const parseTotp = (stored: string): TotpSpec | undefined => {
  const text = stored.trim();
  if (!text.toLowerCase().startsWith("otpauth://")) {
    const secret = base32Decode(text);
    return secret ? { secret, digits: 6, period: 30, algorithm: "SHA1" } : undefined;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.host.toLowerCase() !== "totp") return undefined;
  const secret = base32Decode(url.searchParams.get("secret") ?? "");
  const digits = Number(url.searchParams.get("digits") ?? "6");
  const period = Number(url.searchParams.get("period") ?? "30");
  const algorithm = ALGORITHMS[(url.searchParams.get("algorithm") ?? "SHA1").toUpperCase()];
  if (!secret || !algorithm || !Number.isInteger(digits) || digits < 6 || digits > 10 || !Number.isInteger(period) || period < 1) {
    return undefined;
  }
  return { secret, digits, period, algorithm };
};

/** The 8-byte big-endian counter for a moment. */
const counterBytes = (counter: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  let rest = counter;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return bytes;
};

/** The code at `nowMs` and how many whole seconds it stays valid. */
export const totpAt = (spec: TotpSpec, nowMs: number, hmac: Hmac): { readonly code: string; readonly secondsLeft: number } => {
  const seconds = Math.floor(nowMs / 1000);
  const counter = Math.floor(seconds / spec.period);
  const mac = hmac(spec.algorithm, spec.secret, counterBytes(counter));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  const code = String(binary % 10 ** spec.digits).padStart(spec.digits, "0");
  return { code, secondsLeft: spec.period - (seconds % spec.period) };
};
