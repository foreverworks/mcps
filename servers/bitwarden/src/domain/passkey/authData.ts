import { cborMap, encodeCbor } from "./cbor.js";

/**
 * What a WebAuthn authenticator answers, built the way Bitwarden's own
 * authenticator builds it, so a site cannot tell a passkey used here from one
 * used in Bitwarden's apps. Pure: hashing and signing are the caller's.
 *
 * Source: bitwarden/clients, libs/common/src/platform/services/fido2/
 * fido2-authenticator.service.ts (generateAuthData, authDataFlags,
 * makeCredential), at the tag cli-v2026.10.0
 * (b449ac1d255784380d75ef026343198891286be7):
 * - the AAGUID is Bitwarden's, d548826e-79b4-db40-a3d8-11116f7e8349: the
 *   passkey lives in a Bitwarden vault and syncs to its apps, which is what
 *   that AAGUID tells a site;
 * - the flags: user present always, user verified as the caller says, backup
 *   eligible and backed up always (a vault passkey is synced), attested
 *   credential data on a registration only, never extension data;
 * - the counter, big-endian in four bytes, is the stored one (see passkey.ts);
 * - the attestation is format "none" with an empty statement.
 */

/** Bitwarden's AAGUID, d548826e-79b4-db40-a3d8-11116f7e8349. */
export const AAGUID = Uint8Array.from([0xd5, 0x48, 0x82, 0x6e, 0x79, 0xb4, 0xdb, 0x40, 0xa3, 0xd8, 0x11, 0x11, 0x6f, 0x7e, 0x83, 0x49]);

/** COSE's identifier for ECDSA with SHA-256 on P-256 (ES256), the one algorithm Bitwarden's authenticator makes. */
export const ES256 = -7;

const FLAG = { userPresent: 0x01, userVerified: 0x04, backupEligible: 0x08, backedUp: 0x10, attested: 0x40 } as const;

export type Flags = { readonly userVerified: boolean; readonly attested: boolean };

export const flagsByte = ({ userVerified, attested }: Flags): number =>
  FLAG.userPresent | FLAG.backupEligible | FLAG.backedUp | (userVerified ? FLAG.userVerified : 0) | (attested ? FLAG.attested : 0);

const counterBytes = (counter: number): number[] => {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) throw new RangeError(`a signature counter is 0 to 2^32-1, not ${counter}`);
  return [(counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff];
};

/**
 * The credential's public key as a COSE_Key (RFC 9053): EC2, ES256, P-256 and
 * the two 32-byte coordinates, in canonical order (1, 3, -1, -2, -3).
 */
export const coseKey = (x: Uint8Array, y: Uint8Array): Uint8Array => {
  if (x.length !== 32 || y.length !== 32) throw new RangeError("a P-256 coordinate is 32 bytes");
  return encodeCbor(cborMap([1, 2], [3, ES256], [-1, 1], [-2, x], [-3, y]));
};

export type Attested = { readonly credentialId: Uint8Array; readonly x: Uint8Array; readonly y: Uint8Array };

/**
 * Authenticator data: the RP ID's SHA-256, the flags, the counter, and on a
 * registration the attested credential data (AAGUID, the id's length and the
 * id, the COSE public key).
 */
export const authenticatorData = (args: {
  readonly rpIdHash: Uint8Array;
  readonly userVerified: boolean;
  readonly counter: number;
  readonly attested?: Attested;
}): Uint8Array => {
  if (args.rpIdHash.length !== 32) throw new RangeError("rpIdHash is a SHA-256");
  const head = [...args.rpIdHash, flagsByte({ userVerified: args.userVerified, attested: args.attested !== undefined }), ...counterBytes(args.counter)];
  if (args.attested === undefined) return Uint8Array.from(head);
  const { credentialId, x, y } = args.attested;
  if (credentialId.length === 0 || credentialId.length > 1023) throw new RangeError("a credential id is 1 to 1023 bytes");
  return Uint8Array.from([...head, ...AAGUID, credentialId.length >> 8, credentialId.length & 0xff, ...credentialId, ...coseKey(x, y)]);
};

/** The attestation object of a registration: format "none", an empty statement, the authenticator data. */
export const attestationObject = (authData: Uint8Array): Uint8Array => encodeCbor(cborMap(["fmt", "none"], ["attStmt", cborMap()], ["authData", authData]));

/** What an assertion signs: the authenticator data, then the client data's hash. */
export const signedData = (authData: Uint8Array, clientDataHash: Uint8Array): Uint8Array => {
  const data = new Uint8Array(authData.length + clientDataHash.length);
  data.set(authData, 0);
  data.set(clientDataHash, authData.length);
  return data;
};
