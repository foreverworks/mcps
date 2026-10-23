import { makeErrorKit, makeRequired, OUTCOME_UNKNOWN } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type AppError =
  | { readonly kind: "auth"; readonly code: string; readonly message: string; readonly permanent: boolean }
  | {
      readonly kind: "api";
      readonly status: number;
      readonly message: string;
      /** OUTCOME_UNKNOWN when a filing may have reached ANAF although the call failed. */
      readonly reason?: string | undefined;
      readonly body?: unknown;
    }
  | { readonly kind: "input"; readonly message: string }
  | { readonly kind: "config"; readonly message: string };

/**
 * Refreshing cannot fix these; a human has to sit at a browser with the
 * certificate. `invalid_grant` is the one that matters: ANAF returns it once the
 * refresh token has been rotated out from under us or its lifetime has run out.
 */
const PERMANENT_AUTH_CODES = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "refresh_expired"]);

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

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const configError = (message: string): AppError => ({ kind: "config", message });

/**
 * The `reason` on an upload that failed AFTER it may have reached ANAF: a
 * transport error, a 5xx, or an answer this server could not read. Such a call
 * is never retried, because the one thing worse than a failed filing is the
 * same invoice filed twice.
 */
export { OUTCOME_UNKNOWN };

export const { fail, asAppError } = makeErrorKit<AppError>("anafEfactura");

/**
 * A field ANAF's schema calls optional that this call cannot do without. The
 * generated types are honest that any field may be absent; this is where the
 * code says what happens when one is, which is a loud failure rather than an
 * `undefined` travelling on.
 */
export const required = makeRequired((what) => fail(apiError(0, `ANAF's response had no ${what}`)));

/**
 * Re-running the authorization-code flow is the only fix for a dead grant, and
 * it is a manual one: the browser step needs a qualified certificate in a card
 * reader, which no daemon can supply.
 */
const REAUTHORIZE =
  "call begin_authorization, have the certificate holder open the URL with the qualified certificate, then complete_authorization with the address it lands on";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "check ANAF_CONFIG, app.json and where the state dir and outbox are (see the README, Configuration); with no grant stored yet, run begin_authorization";
    case "auth":
      return error.permanent ? `the grant is dead; ${REAUTHORIZE}` : "transient ANAF-side failure; retry later";
    case "input":
      return "fix the arguments and call again";
    case "api":
      if (error.reason === OUTCOME_UNKNOWN)
        return "the invoice MAY have been filed: check upload_status (with test: false for a production upload) or list_invoices before uploading it again";
      if (error.status === 401 || error.status === 403)
        return `the access token was refused for this CIF or role; check token_status, then ${REAUTHORIZE}`;
      return error.status === 0 ? "ANAF was unreachable; retry later" : "retry; if it persists, check the id and the CIF";
  }
};

/**
 * Whether a human has to act. A revoked grant and a bad deployment do; a 5xx
 * from ANAF does not, and waking somebody for it is how a check stops being
 * believed.
 */
export const needsHuman = (error: AppError): boolean =>
  error.kind === "config" ||
  error.kind === "input" ||
  (error.kind === "auth" && error.permanent) ||
  (error.kind === "api" && (error.status === 401 || error.status === 403));
