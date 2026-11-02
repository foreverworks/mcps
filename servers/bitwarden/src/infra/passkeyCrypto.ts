import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";

import type { PasskeyCrypto } from "../app/ports.js";

const P256 = "prime256v1";

/**
 * ES256 with Node's crypto: P-256 keys, SHA-256, signatures DER-encoded (the
 * form WebAuthn's ES256 asks for, which Bitwarden's apps reach by converting
 * WebCrypto's raw r||s with p1363ToDer). A private key exists here only for
 * the length of one call.
 */
export const makePasskeyCrypto = (): PasskeyCrypto => ({
  newKeyPair: () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: P256 });
    const jwk = publicKey.export({ format: "jwk" });
    if (typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("a P-256 public key without coordinates");
    return {
      pkcs8: new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" })),
      spki: new Uint8Array(publicKey.export({ format: "der", type: "spki" })),
      x: new Uint8Array(Buffer.from(jwk.x, "base64url")),
      y: new Uint8Array(Buffer.from(jwk.y, "base64url")),
    };
  },
  sign: (pkcs8, data) =>
    new Uint8Array(sign("sha256", data, { key: createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" }), dsaEncoding: "der" })),
  sha256: (data) => new Uint8Array(createHash("sha256").update(data).digest()),
  isP256Key: (pkcs8) => {
    try {
      const key = createPrivateKey({ key: Buffer.from(pkcs8), format: "der", type: "pkcs8" });
      return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === P256;
    } catch {
      return false;
    }
  },
});
