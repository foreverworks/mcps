import { createPrivateKey, createVerify } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeSigner, signJwt, TOKEN_LIFETIME_S } from "../src/infra/jwt.js";
import { rejectionOf, TEST_KEY, TEST_KEY_PEM, tempDir } from "./support.js";

// The throwaway key the setup generated for this file. The real one is never read.
const { privateKey, publicKey } = TEST_KEY;
const NOW = 1_800_000_000;

const parts = (jwt: string) => {
  const [header, payload, signature] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(header as string, "base64url").toString()) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload as string, "base64url").toString()) as Record<string, unknown>,
    signature: signature as string,
    signingInput: `${header}.${payload}`,
  };
};

describe("signJwt", () => {
  it("produces a token the matching public key verifies", () => {
    // The whole point of hand-rolling this is that it only ever signs. If the
    // signature did not verify, nothing else here would be worth testing.
    const jwt = signJwt(privateKey, "app-id", NOW);
    const { signature, signingInput } = parts(jwt);
    const ok = createVerify("RSA-SHA256")
      .update(signingInput)
      .end()
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("puts the application id in kid, where Enable Banking looks for it", () => {
    expect(parts(signJwt(privateKey, "app-id", NOW)).header).toEqual({ alg: "RS256", typ: "JWT", kid: "app-id" });
  });

  it("sends the literal issuer the API accepts, and no sub", () => {
    // Not the application_id: this literal is what the API accepts in production.
    const { payload } = parts(signJwt(privateKey, "app-id", NOW));
    expect(payload["iss"]).toBe("enablebanking.com");
    expect(payload["aud"]).toBe("api.enablebanking.com");
    expect(payload).not.toHaveProperty("sub");
  });

  it("is short-lived and unique per call", () => {
    const { payload } = parts(signJwt(privateKey, "app-id", NOW));
    expect(payload["iat"]).toBe(NOW);
    expect(payload["exp"]).toBe(NOW + TOKEN_LIFETIME_S);
    expect(parts(signJwt(privateKey, "app-id", NOW)).payload["jti"]).not.toBe(payload["jti"]);
  });

  it("is base64url throughout, so no segment needs escaping in a header", () => {
    const jwt = signJwt(createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" })), "app-id", NOW);
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe("makeSigner", () => {
  const verifies = (jwt: string): boolean => {
    const { signature, signingInput } = parts(jwt);
    return createVerify("RSA-SHA256").update(signingInput).end().verify(publicKey, Buffer.from(signature, "base64url"));
  };

  it("signs with the key at the path it was given", async () => {
    const path = join(tempDir(), "key.pem");
    writeFileSync(path, TEST_KEY_PEM, { mode: 0o600 });
    const jwt = await makeSigner(path, () => NOW, async () => "app-id")();
    expect(verifies(jwt)).toBe(true);
    expect(parts(jwt).header["kid"]).toBe("app-id");
  });

  it("reports a missing key as auth, and picks it up once it is back", async () => {
    // A key restored while the service runs must work on the next call, not
    // after a restart: the failed load is not remembered.
    const path = join(tempDir(), "key.pem");
    const sign = makeSigner(path, () => NOW, async () => "app-id");
    const error = await rejectionOf(sign);
    expect(error).toMatchObject({ kind: "auth", message: expect.stringContaining(path) });
    writeFileSync(path, TEST_KEY_PEM, { mode: 0o600 });
    expect(verifies(await sign())).toBe(true);
  });

  it("reports a file that is not a key as auth, not as a crash", async () => {
    const path = join(tempDir(), "key.pem");
    writeFileSync(path, "not a pem");
    expect((await rejectionOf(makeSigner(path, () => NOW, async () => "app-id")))?.kind).toBe("auth");
  });
});
