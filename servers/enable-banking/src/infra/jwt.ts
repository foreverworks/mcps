import { createPrivateKey, createSign, randomUUID, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";

import { once } from "@foreverworks/mcp-kit";

import type { Clock } from "../app/ports.js";
import { authError, fail } from "../domain/errors.js";

/** Five minutes, per Enable Banking's guidance. There is nothing to cache. */
export const TOKEN_LIFETIME_S = 300;
const AUDIENCE = "api.enablebanking.com";

const b64url = (value: Buffer | string): string => Buffer.from(value).toString("base64url");

/**
 * RS256 by hand, with node:crypto.
 *
 * A JWT library would be a dependency for ninety characters of base64url and
 * one signature. Nothing here parses or verifies a token, which is where a
 * hand-rolled implementation would actually be dangerous: this only ever signs
 * a payload it built itself.
 */
export const signJwt = (key: KeyObject, applicationId: string, nowEpoch: number): string => {
  const header = { alg: "RS256", typ: "JWT", kid: applicationId };
  const payload = {
    // Not the application_id, though that is easy to assume: the literal
    // string is what the API accepts, and `sub` is not sent at all.
    iss: "enablebanking.com",
    aud: AUDIENCE,
    iat: nowEpoch,
    exp: nowEpoch + TOKEN_LIFETIME_S,
    jti: randomUUID().replace(/-/g, ""),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(key);
  return `${signingInput}.${b64url(signature)}`;
};

/**
 * The key is read and parsed once, then reused.
 *
 * Every API call mints a fresh token, so re-reading the PEM per request would
 * make the file's availability a per-call hazard for no benefit. A key that
 * cannot be read or parsed is an auth failure, and is not remembered as one:
 * `once` retries the load on the next call, so a key restored while the
 * service runs works without a restart.
 */
export const makeSigner = (privateKeyPath: string, now: Clock, applicationId: () => Promise<string>) => {
  const key = once(async (): Promise<KeyObject> => {
    try {
      return createPrivateKey(await readFile(privateKeyPath));
    } catch (cause) {
      return fail(authError(`cannot use the private key at ${privateKeyPath}: ${String(cause)}`));
    }
  });
  return async (): Promise<string> => signJwt(await key(), await applicationId(), now());
};

export type Signer = ReturnType<typeof makeSigner>;
