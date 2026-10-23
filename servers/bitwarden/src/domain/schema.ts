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
