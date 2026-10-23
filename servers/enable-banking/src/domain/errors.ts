import { makeErrorKit, makeRequired, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type AppError =
  | { readonly kind: "auth"; readonly message: string }
  | {
      readonly kind: "api";
      readonly status: number;
      readonly message: string;
      /** Enable Banking's own error code (`EXPIRED_SESSION`, ...), when its body named one. */
      readonly reason?: string | undefined;
      readonly body?: unknown;
    }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "input"; readonly message: string }
  | { readonly kind: "config"; readonly message: string };

/**
 * Signing failed, which here means the private key is missing or unusable.
 * Enable Banking's tokens are minted locally and live five minutes, so there is
 * no grant to expire and nothing to refresh: either the key works or it does not.
 */
export const authError = (message: string): AppError => ({ kind: "auth", message });

export const apiError = (
  status: number,
  message: string,
  extra: { readonly reason?: string | undefined; readonly body?: unknown } = {},
): AppError => ({
  kind: "api",
  status,
  message,
  ...(extra.reason === undefined ? {} : { reason: extra.reason }),
  ...(extra.body === undefined ? {} : { body: extra.body }),
});

export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const configError = (message: string): AppError => ({ kind: "config", message });

export const { fail, asAppError } = makeErrorKit<AppError>("enableBanking");

/**
 * The `reason` on a POST that failed AFTER it may have reached Enable Banking
 * (a transport error or a 5xx). The kit never resends one: a code exchange
 * cannot be repeated, the code is single-use.
 */
export { OUTCOME_UNKNOWN };

/**
 * A field Enable Banking's schema calls optional that this call cannot do
 * without, such as the session id of a consent. The generated types are honest
 * that it may be absent or null; this is where the code says what happens when
 * it is, which is a loud failure rather than an empty string travelling on.
 */
export const required = makeRequired((what) => fail(apiError(0, `Enable Banking's response had no ${what}`)));

/** The error codes that mean the consent itself is gone, which no retry fixes. */
const CONSENT_GONE = new Set(["EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST"]);

/**
 * Whether a failure says the consent no longer exists at the bank: lapsed,
 * revoked, closed, or never there. Revoking one in that state has nothing left
 * to do at the bank.
 */
export const consentGone = (error: AppError): boolean =>
  error.kind === "api" && ((error.reason !== undefined && CONSENT_GONE.has(error.reason)) || error.status === 404);

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "set ENABLE_BANKING_CONFIG to a readable app.json, and ENABLE_BANKING_KEY (or app.json's private_key) to its private key (see the README, Configuration)";
    case "auth":
      return "the private key is missing or not a usable RS256 key; check ENABLE_BANKING_KEY or app.json's private_key";
    case "not_found":
      return "check the label against list_stored_sessions";
    case "input":
      return "fix the arguments and call again";
    case "api":
      if (error.reason === OUTCOME_UNKNOWN)
        return "Enable Banking may have acted without answering; a code cannot be exchanged twice, so run start_auth again rather than repeating the call";
      if (error.reason !== undefined && CONSENT_GONE.has(error.reason))
        return "the consent has lapsed or was revoked; run start_auth, have the account holder approve it in the bank app, then complete_auth";
      // The bank's daily allowance of reads without the account holder (PSD2 allows four); retrying spends nothing back.
      if (error.reason === "ASPSP_RATE_LIMIT_EXCEEDED")
        return "the bank's reads of this account are spent for today; try again tomorrow, and read each period once, narrowed with get_transactions' filters or written out by export_transactions";
      if (error.reason === "EXPIRED_AUTHORIZATION_CODE" || error.reason === "WRONG_AUTHORIZATION_CODE")
        return "the code is single-use and short-lived; run start_auth again and call complete_auth straight after the bank's approval";
      if (error.status === 401 || error.status === 403)
        return "Enable Banking refused the signed JWT; check that app.json's application_id matches the private key";
      // A consent is what expires here, and no amount of retrying renews one.
      if (error.status === 422 || error.status === 404)
        return "the consent may have lapsed; run start_auth and complete_auth for this bank";
      return error.status === 0 ? "Enable Banking was unreachable or answered nonsense; retry later" : "retry; if it persists, check the ids";
  }
};
