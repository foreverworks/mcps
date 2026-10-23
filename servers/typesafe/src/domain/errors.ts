import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts).
 */
export type AppError =
  /** The API key is missing or its file is unreadable; nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /** TypeSafe refused the key (401) or the account (403). */
  | { readonly kind: "auth"; readonly status: number; readonly message: string }
  /** The request cannot be answered as asked: a local check, or TypeSafe's 422 naming the field. */
  | { readonly kind: "input"; readonly message: string; readonly detail?: unknown }
  /** Still throttled (429) or overloaded (529) after every retry. */
  | { readonly kind: "rate_limited"; readonly status: number; readonly message: string }
  /** Any other refusal, a 5xx that outlived its retries, or no connection (status 0). */
  | { readonly kind: "api"; readonly status: number; readonly message: string; readonly body?: unknown }
  /** A 2xx in a shape the SDK's types do not describe. */
  | { readonly kind: "drift"; readonly message: string };

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string, detail?: unknown): AppError =>
  detail === undefined ? { kind: "input", message } : { kind: "input", message, detail };
export const driftError = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("typesafe");

/** Failures that would fail every other item of a batch the same way. */
export const isFatal = (error: AppError): boolean => error.kind === "config" || error.kind === "auth";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "set TYPESAFE_API_KEY_FILE to a file holding a key made at console.typesafe.ai/keys (TYPESAFE_API_KEY for a local run)";
    case "auth":
      return "TypeSafe refused the key; check it still exists at console.typesafe.ai/keys and replace the service's credential if it was revoked";
    case "input":
      return "fix what the message names (a Choice needs at least two options, a Score 2 to 10 levels) and call again";
    case "rate_limited":
      return "TypeSafe is throttling or overloaded; wait a minute, or send the batch with a lower concurrency";
    case "api":
      return "retry once; if it persists, run health and read the server's log";
    case "drift":
      return "TypeSafe answered in a shape this server does not know; the SDK's types may have moved on, so compare with docs.typesafe.ai/api";
  }
};
