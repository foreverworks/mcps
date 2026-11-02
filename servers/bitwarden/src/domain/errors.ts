import { makeErrorKit } from "@foreverworks/mcp-kit";

import type { PasskeyInfo } from "./passkey.js";

/**
 * The ways this server fails, as plain tagged data.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type AppError =
  /** A credential file is missing or empty; nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /** Bitwarden refused the API key or the master password. */
  | { readonly kind: "auth"; readonly message: string }
  /** The CLI ran and said no: a network failure, a refused edit, a timeout. */
  | { readonly kind: "cli"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  /** The caller's arguments cannot become a request. Nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** Have I Been Pwned's range API could not be read; the vault was not changed. */
  | { readonly kind: "unavailable"; readonly message: string }
  /** No passkey in the vault can answer this sign-in. Nothing was signed. */
  | { readonly kind: "no_credential"; readonly message: string }
  /** A sign-in that names no passkey matches several: the caller picks one by its credential id. Nothing was signed. */
  | { readonly kind: "several"; readonly message: string; readonly candidates: readonly PasskeyInfo[] }
  /** The site's exclude list names a passkey the vault holds: it already has one for this account. Nothing was stored. */
  | { readonly kind: "excluded"; readonly message: string }
  /** The site accepts no key this vault makes (ES256 only). Nothing was stored. */
  | { readonly kind: "unsupported"; readonly message: string };

export const configError = (message: string): AppError => ({ kind: "config", message });
export const authError = (message: string): AppError => ({ kind: "auth", message });
export const cliError = (message: string): AppError => ({ kind: "cli", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const unavailable = (message: string): AppError => ({ kind: "unavailable", message });
export const noCredential = (message: string): AppError => ({ kind: "no_credential", message });
export const several = (message: string, candidates: readonly PasskeyInfo[]): AppError => ({ kind: "several", message, candidates });
export const excluded = (message: string): AppError => ({ kind: "excluded", message });
export const unsupported = (message: string): AppError => ({ kind: "unsupported", message });

export const { fail, asAppError } = makeErrorKit<AppError>("bitwarden");

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "set BITWARDEN_CLIENT_ID_FILE, BITWARDEN_CLIENT_SECRET_FILE and BITWARDEN_MASTER_PASSWORD_FILE to the account's API key (web vault: Settings, Security, Keys) and master password; see the server's README";
    case "auth":
      return "Bitwarden refused the API key or the master password: if either changed in the web vault, update the files the server reads them from";
    case "cli":
      return "retry once; if it persists, run the health tool and read the server's log";
    case "not_found":
      return "find_logins lists what exists; ids come from there";
    case "input":
      return "fix the arguments and call again";
    case "unavailable":
      return "retry in a minute; if it persists, check that this server may reach api.pwnedpasswords.com";
    case "no_credential":
      return "list_passkeys shows what the vault holds for the site; with none there, sign in another way, or register one with create_passkey";
    case "several":
      return "call again with credential_id set to the candidate for the account you are signing in as";
    case "excluded":
      return "the site already has a passkey from this vault for this account: sign in with it (assert_passkey) instead of registering another";
    case "unsupported":
      return "this vault makes ES256 (P-256) passkeys only, as Bitwarden's apps do; register on this site with another authenticator";
  }
};
