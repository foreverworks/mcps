/**
 * The other side of a passkey, for the tests and the integration run: what a
 * browser builds (the client data) and what a site checks, with an
 * independent verifier (@simplewebauthn/server); and passkeys made, exported
 * and used the way Bitwarden's own apps do it, with WebCrypto, to prove the
 * vault's format works both ways. Keys are made here, in memory.
 *
 * Bitwarden's side follows bitwarden/clients at the tag cli-v2026.10.0
 * (b449ac1d255784380d75ef026343198891286be7):
 * libs/common/src/platform/services/fido2/fido2-authenticator.service.ts
 * (createKeyView, getPrivateKeyFromFido2Credential, generateAuthData,
 * generateSignature) and libs/common/src/models/export/fido2-credential.export.ts.
 */
import { createHash, KeyObject, sign, webcrypto } from "node:crypto";

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";

import { coseKey } from "../src/domain/passkey/authData.js";

export const b64u = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString("base64url");
const sha256 = (bytes: Uint8Array | string): Buffer => createHash("sha256").update(bytes).digest();

export type ClientData = { readonly challenge: string; readonly origin: string; readonly clientDataJSON: string; readonly hash: string };

/** The client data a browser builds for a request, and its hash, which is all the vault is given. */
export const clientData = (type: "webauthn.create" | "webauthn.get", origin: string): ClientData => {
  const challenge = b64u(webcrypto.getRandomValues(new Uint8Array(32)));
  const json = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return { challenge, origin, clientDataJSON: b64u(json), hash: b64u(sha256(json)) };
};

/** A site's account, as create_passkey's `user` takes it. */
export const user = (name: string) => ({ id: b64u(Buffer.from(`id-of-${name}`)), name, display_name: name.split("@")[0] ?? name });

const rpIdOf = (origin: string): string => new URL(origin).hostname;

/** A site's check of a registration, given create_passkey's answer. */
export const verifyCreate = (made: { credentialId: string; attestationObject: string }, data: ClientData, requireUserVerification: boolean) =>
  verifyRegistrationResponse({
    response: {
      id: made.credentialId,
      rawId: made.credentialId,
      type: "public-key",
      response: { clientDataJSON: data.clientDataJSON, attestationObject: made.attestationObject, transports: ["internal"] },
      clientExtensionResults: {},
    },
    expectedChallenge: data.challenge,
    expectedOrigin: data.origin,
    expectedRPID: rpIdOf(data.origin),
    requireUserVerification,
  });

export type Credential = { readonly id: string; readonly publicKey: Uint8Array; readonly counter: number };

/** A site's check of a sign-in, given assert_passkey's answer and the key it registered. */
export const verifyGet = (
  signed: { credentialId: string; authenticatorData: string; signature: string; userHandle: string | null },
  data: ClientData,
  credential: Credential,
  requireUserVerification: boolean,
) =>
  verifyAuthenticationResponse({
    response: {
      id: signed.credentialId,
      rawId: signed.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: data.clientDataJSON,
        authenticatorData: signed.authenticatorData,
        signature: signed.signature,
        ...(signed.userHandle === null ? {} : { userHandle: signed.userHandle }),
      },
      clientExtensionResults: {},
    },
    expectedChallenge: data.challenge,
    expectedOrigin: data.origin,
    expectedRPID: rpIdOf(data.origin),
    credential: { id: credential.id, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter },
    requireUserVerification,
  });

/** A stored passkey as Bitwarden exports it (Fido2CredentialExport): the counter and discoverable as text. */
export type ExportedPasskey = {
  credentialId: string;
  keyType: string;
  keyAlgorithm: string;
  keyCurve: string;
  keyValue: string;
  rpId: string;
  userHandle: string;
  userName: string;
  counter: string;
  rpName: string;
  userDisplayName: string;
  discoverable: string;
  creationDate: string;
};

/** The bytes a site knows a GUID credential id by. */
export const guidId = (guid: string): string => b64u(Buffer.from(guid.replace(/-/g, ""), "hex"));

/** A passkey made the way Bitwarden's apps make one (createKeyView): WebCrypto, PKCS#8 as base64url, a GUID id, counter 0. */
export const bitwardenMade = async (rpId: string, userName: string, over: Partial<ExportedPasskey> = {}) => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  const entry: ExportedPasskey = {
    credentialId: webcrypto.randomUUID(),
    keyType: "public-key",
    keyAlgorithm: "ECDSA",
    keyCurve: "P-256",
    keyValue: b64u(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey))),
    rpId,
    userHandle: b64u(Buffer.from(`handle-${userName}`)),
    userName,
    counter: "0",
    rpName: "Example",
    userDisplayName: userName,
    discoverable: "true",
    creationDate: "2026-03-04T05:06:07.000Z",
    ...over,
  };
  const publicKey = coseKey(Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url"));
  const id = entry.credentialId.startsWith("b64.") ? entry.credentialId.slice(4) : guidId(entry.credentialId);
  return { entry, credential: { id, publicKey, counter: Number(entry.counter) } satisfies Credential };
};

/** A Bitwarden JSON export (not encrypted) of logins, one per list of passkeys. */
export const exportOf = (origin: string, entries: readonly (readonly ExportedPasskey[])[]) => ({
  encrypted: false,
  folders: [],
  items: entries.map((fido2Credentials, i) => ({
    id: `00000000-0000-4000-8000-0000000000a${i}`,
    organizationId: null,
    folderId: null,
    type: 1,
    reprompt: 0,
    name: `Example ${i}`,
    notes: "imported",
    favorite: false,
    fields: [{ name: "pin", value: "4321", type: 1, linkedId: null }],
    login: { uris: [{ match: null, uri: origin }], username: `user${i}@example.com`, password: `pw-${i}`, totp: null, fido2Credentials },
    collectionIds: null,
  })),
});

/**
 * A sign-in as Bitwarden's own authenticator makes it from a stored passkey
 * (getAssertion): the key imported from `keyValue` with WebCrypto as PKCS#8,
 * authenticator data with user present, backup eligible and backed up, the
 * counter as it advances it (a 0 stays 0, anything above goes up by one), and
 * an ES256 signature in DER. Proof that what this server
 * stores is a passkey Bitwarden's apps can use.
 */
export const bitwardenSigns = async (stored: { credentialId: string; keyValue: string; rpId: string; counter: string | number; userHandle: string }, clientDataHash: string) => {
  const key = await webcrypto.subtle.importKey("pkcs8", Buffer.from(stored.keyValue, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const counter = Number(stored.counter) > 0 ? Number(stored.counter) + 1 : 0;
  const authData = Buffer.concat([sha256(stored.rpId), Buffer.from([0x01 | 0x08 | 0x10]), Buffer.from([counter >>> 24, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff])]);
  const signature = sign("sha256", Buffer.concat([authData, Buffer.from(clientDataHash, "base64url")]), { key: KeyObject.from(key), dsaEncoding: "der" });
  const credentialId = stored.credentialId.startsWith("b64.") ? stored.credentialId.slice(4) : guidId(stored.credentialId);
  return { credentialId, authenticatorData: b64u(authData), signature: b64u(signature), userHandle: stored.userHandle };
};
