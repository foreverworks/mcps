/**
 * What the use cases need, stated as functions. infra/ satisfies them; nothing
 * in app/ or domain/ imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { RandomInt } from "../domain/password.js";
import type { Collection, Login, LoginDraft, LoginFilter, NoteDraft, Organization, Passkey, VaultStatus } from "../domain/schema.js";
import type { Hmac } from "../domain/totp.js";

export type VaultPort = {
  /** Logged in and unlocked as a side effect: a status that says "unlocked" proves both credentials. */
  readonly status: () => Promise<VaultStatus>;
  /** Pull what changed on the server (an item someone added in the web vault); at most once per 30 s unless forced. */
  readonly sync: (options?: { readonly force?: boolean }) => Promise<void>;
  readonly listLogins: (filter: LoginFilter) => Promise<readonly Login[]>;
  readonly getLogin: (id: string) => Promise<Login>;
  readonly createLogin: (draft: LoginDraft) => Promise<Login>;
  readonly editLogin: (id: string, draft: LoginDraft) => Promise<Login>;
  /** A new secure note, read back as the vault stored it. */
  readonly createNote: (draft: NoteDraft) => Promise<Login>;
  /**
   * Replace an organization item's collections with these, all of its own
   * organization. Bitwarden refuses an item outside any organization. Read the
   * item back after a forced sync to see what the server holds.
   */
  readonly moveItem: (id: string, collectionIds: readonly string[]) => Promise<void>;
  /**
   * Leave a login holding exactly these passkeys, its other fields as they
   * are, and answer it as the vault read it back. A stored passkey this
   * server cannot read is kept whatever the list says.
   */
  readonly setPasskeys: (id: string, passkeys: readonly Passkey[]) => Promise<Login>;
  readonly collections: () => Promise<readonly Collection[]>;
  readonly organizations: () => Promise<readonly Organization[]>;
};

/** A new ES256 key pair: the private key in PKCS#8 DER, the public one in SPKI DER and as its two coordinates. */
export type KeyPair = { readonly pkcs8: Uint8Array; readonly spki: Uint8Array; readonly x: Uint8Array; readonly y: Uint8Array };

/** The cryptography a passkey needs, all of it ECDSA on P-256 with SHA-256. */
export type PasskeyCrypto = {
  readonly newKeyPair: () => KeyPair;
  /** An ES256 signature over `data` with a PKCS#8 P-256 key, DER-encoded as WebAuthn wants it. */
  readonly sign: (pkcs8: Uint8Array, data: Uint8Array) => Uint8Array;
  readonly sha256: (data: Uint8Array) => Uint8Array;
  /** Whether these bytes are a P-256 private key in PKCS#8 DER. */
  readonly isP256Key: (pkcs8: Uint8Array) => boolean;
};

export type Deps = {
  readonly vault: VaultPort;
  readonly now: () => number;
  readonly randomInt: RandomInt;
  readonly hmac: Hmac;
  /** The collection a new login goes to when the caller names none; unset means the account's own vault. */
  readonly defaultCollection: string | undefined;
  /** The kit's input-file reader: a password or a note's secret that is already in a file, so it is never retyped. */
  readonly readInput: InputFiles;
  /** A text's SHA-1, as hex. */
  readonly sha1: (text: string) => string;
  /** One range of Have I Been Pwned's Pwned Passwords, by its five-character prefix, as the API answers it. */
  readonly pwnedRange: (prefix: string) => Promise<string>;
  readonly passkeyCrypto: PasskeyCrypto;
  /** A random GUID, lower case: a new passkey's credential id, as Bitwarden's authenticator makes them. */
  readonly newCredentialId: () => string;
  /** The input-file reader for an export to import, with a ceiling an export fits under. */
  readonly readExport: InputFiles;
};
