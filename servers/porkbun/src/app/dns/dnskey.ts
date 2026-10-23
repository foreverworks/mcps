import { createHash, createPublicKey, type JsonWebKey } from "node:crypto";

import { type Dnskey, dnskeyRdata, DIGEST_TYPES, type Ds, keyTagOf, ownerWire } from "../../domain/dns/ds.js";
import { fail, inputError } from "../../domain/errors.js";

/**
 * A DS record computed from the DNSKEY it points at (RFC 4034 section 5.1.4),
 * so nobody types a digest; and the key itself checked first, where its
 * algorithm makes that cheap: an elliptic-curve key must be a point on its
 * curve, an RSA key must hold an exponent and a modulus of a sane size, an
 * Edwards key must be its curve's length.
 */

/** The digest types this server can compute, by node:crypto's names. */
const HASHES: ReadonlyMap<number, string> = new Map([
  [1, "sha1"],
  [2, "sha256"],
  [4, "sha384"],
]);

const b64url = (bytes: Buffer): string => bytes.toString("base64url");

const ecProblem = (key: Buffer, crv: "P-256" | "P-384", size: number): string | undefined => {
  if (key.length !== 2 * size) return `an ${crv} key is ${2 * size} bytes, this one is ${key.length}`;
  const jwk: JsonWebKey = { kty: "EC", crv, x: b64url(key.subarray(0, size)), y: b64url(key.subarray(size)) };
  try {
    createPublicKey({ key: jwk, format: "jwk" });
    return undefined;
  } catch {
    return `the key is not a point on ${crv}: a character of it was lost or changed`;
  }
};

/** RFC 3110: an exponent length (one byte, or zero then two), the exponent, then the modulus. */
const rsaProblem = (key: Buffer): string | undefined => {
  const long = key[0] === 0;
  const exponentLength = long ? key.readUInt16BE(1) : (key[0] ?? 0);
  const start = long ? 3 : 1;
  const modulus = key.subarray(start + exponentLength);
  if (exponentLength === 0 || key.length <= start + exponentLength) return "the RSA key holds no modulus after its exponent";
  const bits = modulus.length * 8;
  if (bits < 512 || bits > 4096) return `the RSA modulus is ${bits} bits; a DNSSEC RSA key is 512 to 4096 (RFC 3110)`;
  try {
    createPublicKey({ key: { kty: "RSA", n: b64url(modulus), e: b64url(key.subarray(start, start + exponentLength)) }, format: "jwk" });
    return undefined;
  } catch {
    return "the RSA key does not parse";
  }
};

/** What is wrong with the key material, where its algorithm lets that be checked; undefined otherwise. */
const keyProblem = (key: Dnskey): string | undefined => {
  switch (key.algorithm) {
    case 5:
    case 7:
    case 8:
    case 10:
      return rsaProblem(key.publicKey);
    case 13:
      return ecProblem(key.publicKey, "P-256", 32);
    case 14:
      return ecProblem(key.publicKey, "P-384", 48);
    case 15:
      return key.publicKey.length === 32 ? undefined : `an Ed25519 key is 32 bytes, this one is ${key.publicKey.length}`;
    case 16:
      return key.publicKey.length === 57 ? undefined : `an Ed448 key is 57 bytes, this one is ${key.publicKey.length}`;
    default:
      return undefined;
  }
};

/** The DS record for `key` at `zone`, with `digestType` (2, SHA-256, unless given). */
export const dsOf = (zone: string, key: Dnskey, digestType: number): Ds => {
  const hash = HASHES.get(digestType);
  if (hash === undefined) {
    const name = DIGEST_TYPES.get(digestType)?.name ?? "that type";
    return fail(inputError(`this server computes digest types 1, 2 and 4, not ${digestType} (${name}); use 2, which every registry accepts`));
  }
  if (key.algorithm === 1) return fail(inputError("a key of algorithm 1 (RSAMD5) is not computed here: nothing should be signed with it"));
  const problem = keyProblem(key);
  if (problem !== undefined) return fail(inputError(`dnskey: ${problem}`));
  const rdata = dnskeyRdata(key);
  return {
    keyTag: String(keyTagOf(rdata)),
    alg: String(key.algorithm),
    digestType: String(digestType),
    digest: createHash(hash).update(Buffer.concat([ownerWire(zone), rdata])).digest("hex").toUpperCase(),
  };
};
