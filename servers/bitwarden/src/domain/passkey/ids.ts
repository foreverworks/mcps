/**
 * Byte strings as WebAuthn's JSON carries them (base64url, no padding), and a
 * passkey's credential id in the two forms Bitwarden stores it. Pure.
 *
 * Bitwarden's authenticator makes every credential id a random GUID and stores
 * it in that text form; the id a site sees is the GUID's 16 bytes. An id that
 * is not a GUID (a passkey imported from another provider) is stored as "b64."
 * followed by its base64url. Source: bitwarden/clients,
 * libs/common/src/platform/services/fido2/credential-id-utils.ts
 * (parseCredentialId) and guid-utils.ts (guidToRawFormat), at the tag
 * cli-v2026.10.0 (b449ac1d255784380d75ef026343198891286be7).
 */

const BASE64URL = /^[A-Za-z0-9_-]*$/;
/** Bitwarden's own test for a GUID (Utils.guidRegex, case ignored). */
const GUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const B64_PREFIX = "b64.";

export const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Strict: only the base64url alphabet, no padding, and a length a byte string can have. `undefined` otherwise. */
export const fromBase64Url = (text: string): Uint8Array | undefined => {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Buffer.from(text, "base64url"));
  return toBase64Url(bytes) === text ? bytes : undefined;
};

export const isGuid = (text: string): boolean => GUID.test(text);

/** A GUID's 16 bytes, in the order its text reads (big-endian throughout, as Bitwarden's guidToRawFormat). */
export const guidBytes = (guid: string): Uint8Array => Uint8Array.from(Buffer.from(guid.replace(/-/g, ""), "hex"));

/** The bytes a site knows a stored credential id by, or `undefined` for text that is neither form. */
export const rawCredentialId = (stored: string): Uint8Array | undefined => {
  if (stored.startsWith(B64_PREFIX)) {
    const bytes = fromBase64Url(stored.slice(B64_PREFIX.length));
    return bytes !== undefined && bytes.length > 0 ? bytes : undefined;
  }
  return isGuid(stored) ? guidBytes(stored) : undefined;
};

/** A stored credential id as WebAuthn's JSON names it (base64url), or `undefined` when it cannot be read. */
export const webauthnId = (stored: string): string | undefined => {
  const raw = rawCredentialId(stored);
  return raw === undefined ? undefined : toBase64Url(raw);
};

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);
