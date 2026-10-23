import { type KeyObject, sign } from "node:crypto";

/**
 * A JSON Web Token signed here (RFC 7519): App Store Connect takes one as the
 * bearer itself (ES256), Google trades one for an access token (RS256). ES256
 * signatures are the raw r||s pair JWS wants (RFC 7518 3.4), not DER.
 */
/** A clock for the tokens signed here, which a test pins (seconds since the epoch). */
export type ClockOptions = { readonly nowEpoch?: () => number };

export const epochSeconds = (): number => Math.floor(Date.now() / 1000);

const segment = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

export const signJwt = (alg: "ES256" | "RS256", header: Readonly<Record<string, string>>, claims: Readonly<Record<string, unknown>>, key: KeyObject): string => {
  const input = `${segment({ alg, typ: "JWT", ...header })}.${segment(claims)}`;
  const signature = sign("sha256", Buffer.from(input), alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${signature.toString("base64url")}`;
};
