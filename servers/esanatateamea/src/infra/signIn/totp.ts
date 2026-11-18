import { createHmac } from "node:crypto";

/**
 * An authenticator app's six digits, from its secret (RFC 6238, on RFC
 * 4226's HOTP): the base32 key a site shows under its QR code, or the whole
 * `otpauth://totp/...` address the QR code holds, whose `algorithm`,
 * `digits` and `period` then override Keycloak's defaults (SHA1, 6, 30 s).
 * Pure apart from the HMAC.
 */
export type TotpKey = { readonly key: Buffer; readonly algorithm: "sha1" | "sha256" | "sha512"; readonly digits: number; readonly period: number };

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32 = (text: string): Buffer | undefined => {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  if (clean === "" || [...clean].some((c) => !BASE32.includes(c))) return undefined;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** The key in a secret as people copy it, or undefined when it is not one. */
export const totpKeyOf = (secret: string): TotpKey | undefined => {
  const text = secret.trim();
  if (!text.toLowerCase().startsWith("otpauth://")) {
    const key = base32(text);
    return key === undefined ? undefined : { key, algorithm: "sha1", digits: 6, period: 30 };
  }
  const url = URL.parse(text);
  const key = base32(url?.searchParams.get("secret") ?? "");
  if (url === null || key === undefined) return undefined;
  const algorithm = (url.searchParams.get("algorithm") ?? "SHA1").toLowerCase().replace("-", "");
  const digits = Number(url.searchParams.get("digits") ?? "6");
  const period = Number(url.searchParams.get("period") ?? "30");
  if ((algorithm !== "sha1" && algorithm !== "sha256" && algorithm !== "sha512") || !(digits >= 6 && digits <= 8) || !(period > 0)) return undefined;
  return { key, algorithm, digits, period };
};

/** The code at `epochSeconds`, and how many seconds it has left. */
export const totpAt = (k: TotpKey, epochSeconds: number): { readonly code: string; readonly secondsLeft: number } => {
  const counter = Math.floor(epochSeconds / k.period);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(k.algorithm, k.key).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return { code: String(binary % 10 ** k.digits).padStart(k.digits, "0"), secondsLeft: k.period - (epochSeconds % k.period) };
};
