/**
 * The vault as this server models it: the parts of a Bitwarden item a login
 * needs. The CLI's JSON is parsed into these in infra/bw/wire.ts, so nothing
 * above infra/ knows the CLI's field names.
 */

export type Uri = { readonly uri: string };

/** A custom field. Bitwarden's `hidden` type is a secret; `text` and `boolean` are not. */
export type Field = { readonly name: string; readonly value: string | null; readonly hidden: boolean };

/**
 * A login, or a secure note: a note is read the way a login is (its notes and
 * custom fields, where a person may keep a licence key or a token), but it has
 * no password, authenticator key or URLs. This server creates notes and edits
 * logins only.
 */
export type ItemKind = "login" | "note";

export type Login = {
  readonly id: string;
  readonly kind: ItemKind;
  readonly name: string;
  readonly organizationId: string | null;
  readonly collectionIds: readonly string[];
  readonly notes: string | null;
  readonly username: string | null;
  readonly password: string | null;
  /** The authenticator key as stored: an otpauth:// URI or a bare base32 secret. */
  readonly totp: string | null;
  readonly uris: readonly Uri[];
  readonly fields: readonly Field[];
  readonly revisionDate: string;
  readonly passwordRevisionDate: string | null;
  /** The passwords this login had before, newest first, as Bitwarden keeps them (its last five). */
  readonly previousPasswords: readonly PreviousPassword[];
  /** The login's passkeys (Bitwarden's apps keep one per login). */
  readonly passkeys: readonly Passkey[];
};

/**
 * A passkey as Bitwarden stores it in a login (`login.fido2Credentials`, the
 * shape of its Fido2CredentialExport): every field kept, so an edit writes back
 * exactly what was read.
 */
export type Passkey = {
  /** As stored: a GUID (what Bitwarden's authenticator makes) or "b64." and the id's base64url (domain/passkey/ids.ts). */
  readonly credentialId: string;
  /** "public-key". */
  readonly keyType: string;
  /** "ECDSA". */
  readonly keyAlgorithm: string;
  /** "P-256". */
  readonly keyCurve: string;
  /** The private key, base64url of its PKCS#8 DER. Used inside this process to sign; never in a result, an error or a log. */
  readonly keyValue: string;
  readonly rpId: string;
  readonly rpName: string | null;
  /** The site's id for the account (WebAuthn's user.id), base64url. */
  readonly userHandle: string | null;
  readonly userName: string | null;
  readonly userDisplayName: string | null;
  /** The signature counter; Bitwarden's apps make it 0 and never advance a 0 (see domain/passkey.ts). */
  readonly counter: number;
  /** Whether a site may find it without naming it (a resident key). */
  readonly discoverable: boolean;
  /** ISO 8601, when it was made. */
  readonly creationDate: string | null;
};

/** A replaced password, and when it stopped being the login's. */
export type PreviousPassword = { readonly password: string; readonly until: string | null };

export type Collection = { readonly id: string; readonly name: string; readonly organizationId: string };
export type Organization = { readonly id: string; readonly name: string };

export type VaultStatus = {
  readonly status: "unauthenticated" | "locked" | "unlocked";
  readonly userEmail: string | null;
  readonly serverUrl: string | null;
  readonly lastSync: string | null;
};

/** A login to create, or the whole of one after an edit: what the CLI is handed. */
export type LoginDraft = {
  readonly name: string;
  readonly organizationId: string | null;
  readonly collectionIds: readonly string[];
  readonly notes: string | null;
  readonly username: string | null;
  readonly password: string | null;
  readonly totp: string | null;
  readonly uris: readonly Uri[];
  readonly fields: readonly Field[];
  /** A new login's passkeys; an edit through editLogin leaves the stored ones as they are. */
  readonly passkeys?: readonly Passkey[];
};

/** A secure note to create: what the CLI is handed. Its secrets are in `fields`, hidden ones by default. */
export type NoteDraft = {
  readonly name: string;
  readonly organizationId: string | null;
  readonly collectionIds: readonly string[];
  readonly notes: string | null;
  readonly fields: readonly Field[];
};

export type LoginFilter = { readonly search?: string; readonly url?: string };
