import { makeErrorKit, makeRequired, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data, shared by Gmail, Calendar
 * and Drive because the failures are Google's before they are any product's:
 * one token refresh, one HTTP layer.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 *
 * What stays per product is the REMEDY (<product>/domain/errors.ts): the same
 * 403 means a different consent in each.
 *
 * `ambiguous` is not a flavour of `input`, and the separation is the point:
 * Drive lets two objects hold the same name in the same folder, so a path is a
 * QUERY, not an address, and a file mirror silently drops one of each such
 * pair. A caller that asked by path deserves to be told which ids matched
 * rather than have one picked for it.
 */
export type AppError =
  | { readonly kind: "auth"; readonly code: string; readonly message: string; readonly permanent: boolean }
  | {
      readonly kind: "api";
      readonly status: number;
      readonly reason?: string | undefined;
      readonly message: string;
      readonly body?: unknown;
    }
  | { readonly kind: "config"; readonly message: string }
  /** The caller's arguments cannot be turned into a request. Nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** Google's rate limit held through every retry. Waiting fixes it; a human does not. */
  | { readonly kind: "quota"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "ambiguous"; readonly message: string; readonly candidates: readonly string[] };

/**
 * Refreshing cannot fix these; a human has to act. The last two are ours, not
 * Google's: a write refused before any request because the grant cannot write
 * (a Gmail account on its read-only grant) or lacks the scope (a Calendar
 * grant with the events box left unticked on the granular consent screen).
 */
const PERMANENT_AUTH_CODES = new Set([
  "invalid_grant",
  "invalid_client",
  "deleted_client",
  "readonly_grant",
  "insufficient_scope",
  // A consent approved as the wrong account, or without a refresh token: only a new consent fixes it.
  "wrong_account",
  "no_refresh_token",
]);

export const authError = (code: string, message: string): AppError => ({
  kind: "auth",
  code,
  message,
  permanent: PERMANENT_AUTH_CODES.has(code),
});

export const apiError = (
  status: number,
  message: string,
  extra: { readonly reason?: string | undefined; readonly body?: unknown } = {},
): AppError => ({ kind: "api", status, message, ...extra });

export const configError = (message: string): AppError => ({ kind: "config", message });

export const inputError = (message: string): AppError => ({ kind: "input", message });

export const quotaError = (message: string): AppError => ({ kind: "quota", message });

export const notFoundError = (message: string): AppError => ({ kind: "not_found", message });

export const ambiguousError = (message: string, candidates: readonly string[]): AppError => ({
  kind: "ambiguous",
  message,
  candidates,
});

/** The remedy for a quota failure, the same sentence in every product. */
export const QUOTA_REMEDY = "Google's per-minute quota held through every retry; wait a minute and call again";

/**
 * The `reason` on a write that failed AFTER it may have reached Google: a
 * transport error or a 5xx on a create or a send. Such a call is never
 * retried, because the one thing worse than a failed send is the same mail
 * sent twice, and the one thing worse than a missing event is the same event
 * with its attendees invited twice.
 */
export { OUTCOME_UNKNOWN };

export const { fail, asAppError } = makeErrorKit<AppError>("google");

/**
 * A field Google's schema calls optional that this call cannot do without: an
 * id to act on, a name to show. Generated types are honest that any field may
 * be absent; this is where the code says what happens when one is, which is a
 * loud failure rather than an empty string travelling on.
 */
export const required = makeRequired((what) => fail(apiError(0, `Google's response had no ${what}`)));

/**
 * Whether a human has to act. A revoked grant and a bad credentials file do; a
 * 5xx from Google does not, and waking somebody for it is how a check stops
 * being believed.
 */
export const needsHuman = (error: AppError): boolean =>
  error.kind === "config" ||
  error.kind === "input" ||
  error.kind === "not_found" ||
  error.kind === "ambiguous" ||
  (error.kind === "auth" && error.permanent) ||
  (error.kind === "api" && (error.status === 401 || error.status === 403));

/**
 * A sentence describing whatever was thrown, for the degrade paths that report
 * ONE failure and carry on: a dead mailbox in a multi-account search, a dead
 * account in an agenda that spans both. Our failures are tagged plain objects,
 * not Errors, so `String(thrown)` would read "[object Object]" in exactly the
 * case the per-account report exists to make legible.
 */
export const describeThrownWith =
  (remedyFor: (error: AppError) => string) =>
  (thrown: unknown): string => {
    const known = asAppError(thrown);
    if (known === undefined) return thrown instanceof Error ? thrown.message : String(thrown);
    // Google's error_description is often just "Bad Request"; the CODE is the
    // part an operator can act on, so it leads.
    const detail = known.kind === "auth" ? `${known.code}: ${known.message}` : known.message;
    return `${detail} -- ${remedyFor(known)}`;
  };

/**
 * The one way a grant is made or remade: through the server, which keeps its
 * grants in its own state and never hands a token out. Every product's remedy
 * says it in these words.
 */
export const reconsent = (product: "gmail" | "calendar" | "editors" | "drive" | "tasks" | "contacts" | "meet"): string =>
  `begin_consent (product ${product}, the account), have the account's user approve it in a browser, then complete_consent with the URL the browser lands on`;
