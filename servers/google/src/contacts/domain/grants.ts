import { SCOPE_ROOT } from "../../domain/scopes.js";

/**
 * Read-only, one scope per place a person's address can be found:
 *   contacts.readonly        the account's own contacts
 *   contacts.other.readonly  "other contacts": everyone the account wrote to or heard from, saved by Gmail
 *   directory.readonly       a Workspace domain's directory (its people and its shared contacts)
 * The first two are required. The directory is optional, because only a
 * Workspace account has one: a personal account's grant is healthy without it.
 */
export const CONTACTS_READONLY = `${SCOPE_ROOT}contacts.readonly`;
export const CONTACTS_OTHER_READONLY = `${SCOPE_ROOT}contacts.other.readonly`;
export const DIRECTORY_READONLY = `${SCOPE_ROOT}directory.readonly`;
/** The full scope, never asked for; recognised so a wider grant is not misjudged. */
const CONTACTS = `${SCOPE_ROOT}contacts`;

export const REQUIRED_SCOPES = [CONTACTS_READONLY, CONTACTS_OTHER_READONLY] as const;
export const OPTIONAL_SCOPES = [DIRECTORY_READONLY] as const;

export const SOURCES = ["contacts", "other", "directory"] as const;
export type Source = (typeof SOURCES)[number];

/** Whether a grant can read a source. */
export const canRead = (granted: readonly string[], source: Source): boolean => {
  switch (source) {
    case "contacts":
      return granted.includes(CONTACTS_READONLY) || granted.includes(CONTACTS);
    case "other":
      return granted.includes(CONTACTS_OTHER_READONLY);
    case "directory":
      return granted.includes(DIRECTORY_READONLY);
  }
};

export const scopeOf = (source: Source): string =>
  source === "contacts" ? CONTACTS_READONLY : source === "other" ? CONTACTS_OTHER_READONLY : DIRECTORY_READONLY;
