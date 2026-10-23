import { makeErrorKit } from "@foreverworks/mcp-kit";
import { type CommonError, commonRemedy, joinErrors } from "@foreverworks/receipts/domain";

/**
 * The ways reaching Bolt fails, as plain tagged data. The failures every
 * receipts server shares (input, not_found, config) are packages/receipts'.
 *
 * No classes and no `instanceof`: the tag is the discriminator, which survives
 * being serialised, crossing a module boundary, or being rebuilt from JSON.
 */
export type BoltError =
  | { readonly kind: "auth"; readonly code: number; readonly message: string; readonly permanent: boolean }
  | { readonly kind: "api"; readonly status: number; readonly code?: number | undefined; readonly message: string };

export type AppError = BoltError | CommonError;

/** Bolt answers HTTP 200 for everything; `code` in the body is the real status. */
export const TOO_MANY_REQUESTS = 1005;

/**
 * Minting an access token failed for a reason other than throttling or the
 * network. Bolt does not document its codes, so every such refusal is treated as
 * a dead refresh token: a human re-extracting it is the only fix that exists.
 */
export const authError = (code: number, message: string, permanent = true): AppError => ({
  kind: "auth",
  code,
  message,
  permanent,
});

export const apiError = (status: number, message: string, code?: number): AppError => ({
  kind: "api",
  status,
  message,
  ...(code === undefined ? {} : { code }),
});

export const { fail, asAppError } = joinErrors(makeErrorKit<BoltError>("boltFood"));

/** Failures that will recur on every order in a batch, so a batch should stop rather than record them per row. */
export const isSystemic = (error: AppError): boolean =>
  error.kind === "auth" || error.kind === "config" || (error.kind === "api" && error.status === 0);

const REEXTRACT =
  "sign in at https://food.bolt.eu, re-extract the refresh token as the bolt-food README describes (Configuration), " +
  "and replace the file BOLT_FOOD_CREDS names";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "auth":
      return error.permanent ? `the refresh token was refused; ${REEXTRACT}` : "transient; retry later";
    case "api":
      return error.code === TOO_MANY_REQUESTS
        ? "Bolt is throttling; wait a minute and retry"
        : "retry; if it persists the Bolt web app may have changed its API";
    default:
      return commonRemedy(error);
  }
};

/** This server's failures and remedies, for the tool envelope and the health check. */
export const VOCABULARY = { asAppError, remedyFor };
