/**
 * What the use cases need, stated as functions. infra/ satisfies them; nothing
 * in app/ or domain/ imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { RandomInt } from "../domain/password.js";
import type { Collection, Login, LoginDraft, LoginFilter, NoteDraft, Organization, VaultStatus } from "../domain/schema.js";
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
  readonly collections: () => Promise<readonly Collection[]>;
  readonly organizations: () => Promise<readonly Organization[]>;
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
};
