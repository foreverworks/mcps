import { createPublicKey, type KeyObject } from "node:crypto";

import { decodeBase64Strict } from "@foreverworks/mcp-kit";

import { dkimTags } from "../../domain/dns/txt.js";

/**
 * A DKIM key record's public key (RFC 6376 3.6.1), checked to BE a key before
 * it is published: a DKIM key is long base64 a model copies, and one changed
 * character publishes a record every receiver fails to verify with, which
 * nothing reports until mail lands in spam.
 */

/** Receivers ignore RSA keys under this many bits (RFC 8301). */
const MIN_RSA_BITS = 1024;
const ED25519_BYTES = 32;

/** As DKIM tools print it (SubjectPublicKeyInfo), or the bare RSAPublicKey RFC 6376's text names. */
const rsaKey = (der: Buffer): KeyObject | undefined => {
  for (const type of ["spki", "pkcs1"] as const) {
    try {
      return createPublicKey({ key: der, format: "der", type });
    } catch {
      // Not this encoding; try the next.
    }
  }
  return undefined;
};

/** What is wrong with a DKIM record's key, or undefined when it is a key (or `p=` is empty: a revoked key). */
export const dkimProblem = (text: string): string | undefined => {
  const tags = dkimTags(text);
  const p = tags.get("p");
  if (p === undefined) return "a DKIM record needs p=, the public key (an empty p= revokes it)";
  if (p === "") return undefined;
  const der = decodeBase64Strict(p);
  if (der === undefined) return "p= is not standard base64: a character was lost or changed";
  const kind = (tags.get("k") ?? "rsa").toLowerCase();
  if (kind === "ed25519") return der.length === ED25519_BYTES ? undefined : `p= holds ${der.length} bytes; an ed25519 key (k=ed25519) is ${ED25519_BYTES}`;
  if (kind !== "rsa") return `k=${kind} is not a DKIM key type (rsa or ed25519)`;
  const key = rsaKey(der);
  if (key === undefined) return "p= is base64 but not an RSA public key: a character was likely lost or changed";
  if (key.asymmetricKeyType !== "rsa") return `p= holds a ${key.asymmetricKeyType ?? "non-RSA"} key, and k= says rsa`;
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  return bits < MIN_RSA_BITS ? `p= is a ${bits}-bit RSA key; receivers ignore keys under ${MIN_RSA_BITS} bits` : undefined;
};
