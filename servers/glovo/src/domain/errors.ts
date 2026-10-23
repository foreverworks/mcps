import { makeErrorKit } from "@foreverworks/mcp-kit";
import { type CommonError, commonRemedy, joinErrors } from "@foreverworks/receipts/domain";

/**
 * The ways reaching Glovo fails, as plain tagged data. The failures every
 * receipts server shares (input, not_found, config) are packages/receipts'.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type GlovoError =
  | { readonly kind: "auth"; readonly status: number; readonly message: string; readonly permanent: boolean }
  | { readonly kind: "api"; readonly status: number; readonly code?: string | undefined; readonly message: string };

export type AppError = GlovoError | CommonError;

/** Glovo throttles with a real HTTP 429 and `{"errorCode": "too_many_requests"}`. */
export const TOO_MANY_REQUESTS = 429;

/**
 * Minting an access token failed. A refusal (400/401/403) means the refresh
 * token is dead and only a human re-extracting it helps; throttling, a 5xx or
 * the network going away is `permanent: false`.
 */
export const authError = (status: number, message: string, permanent = true): AppError => ({
  kind: "auth",
  status,
  message,
  permanent,
});

export const apiError = (status: number, message: string, code?: string): AppError => ({
  kind: "api",
  status,
  message,
  ...(code === undefined ? {} : { code }),
});

export const { fail, asAppError } = joinErrors(makeErrorKit<GlovoError>("glovo"));

/**
 * Failures that will recur on every order in a batch, so a batch should stop
 * rather than record them per row. Throttling that outlasted the backoff is one
 * of them: the next order would only be throttled too.
 */
export const isSystemic = (error: AppError): boolean =>
  error.kind === "auth" ||
  error.kind === "config" ||
  (error.kind === "api" && (error.status === 0 || error.status === TOO_MANY_REQUESTS));

const REEXTRACT =
  "sign in at https://glovoapp.com, re-extract the refresh token and device urn as the glovo README describes (Configuration), " +
  "and replace the file GLOVO_CREDS names";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "auth":
      return error.permanent ? `the refresh token was refused; ${REEXTRACT}` : "transient; retry later";
    case "api":
      return error.status === TOO_MANY_REQUESTS
        ? "Glovo is throttling; wait a minute and retry"
        : "retry; if it persists the Glovo web app may have changed its API";
    default:
      return commonRemedy(error);
  }
};

/** This server's failures and remedies, for the tool envelope and the health check. */
export const VOCABULARY = { asAppError, remedyFor };
