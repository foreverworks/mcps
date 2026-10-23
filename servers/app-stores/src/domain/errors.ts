import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts).
 * `store` names the store a failure came from where it matters for the
 * remedy: the two have their own credentials, consoles and roles.
 */
export type Store = "app_store" | "play";

export type AppError =
  /** The store's credentials are not set or cannot be read; nothing was sent. */
  | { readonly kind: "config"; readonly store: Store; readonly message: string }
  /** The store refused the credentials themselves: a revoked key, a deleted service account. */
  | { readonly kind: "auth"; readonly store: Store; readonly status: number; readonly message: string }
  /** The credentials work but may not do this: a key without the role, a service account without the app. */
  | { readonly kind: "forbidden"; readonly store: Store; readonly status: number; readonly message: string }
  /** No such app, review, submission or package, as the store or this server looked it up. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The arguments cannot become a request, or the store refused them as invalid. Nothing changed. */
  | { readonly kind: "input"; readonly message: string }
  /** Still throttled after the retries. */
  | { readonly kind: "rate_limited"; readonly store: Store; readonly message: string }
  /** A reply that failed AFTER it may have reached the store: look before sending it again. */
  | { readonly kind: "outcome_unknown"; readonly store: Store; readonly message: string }
  /** The store was unreachable (status 0) or unwell. */
  | { readonly kind: "api"; readonly store: Store; readonly status: number; readonly message: string }
  /** The store answered in a shape this server does not know, or without a field it always sends. */
  | { readonly kind: "drift"; readonly store: Store; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });

export const { fail, asAppError } = makeErrorKit<AppError>("app-stores");

const CONSOLE: Readonly<Record<Store, string>> = {
  app_store: "App Store Connect (Users and Access, Integrations, App Store Connect API)",
  play: "Play Console (Users and permissions) and the service account's Google Cloud project",
};

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return error.store === "app_store"
        ? "give the server an App Store Connect API key: ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY_FILE naming the .p8 file (see the server's README)"
        : "give the server a Google Play service account: PLAY_SERVICE_ACCOUNT_FILE naming its JSON key (see the server's README)";
    case "auth":
      return `the store refused the credentials: check the key or service account still exists and is active in ${CONSOLE[error.store]}, and replace the service's credential file if it was revoked`;
    case "forbidden":
      return error.store === "app_store"
        ? "the API key lacks the role for this: reading and answering reviews needs Customer Support, TestFlight feedback needs Developer (App Store Connect, Users and Access, Integrations)"
        : "the service account cannot do this for that app: in Play Console, Users and permissions, give it View app information (to read reviews) and Reply to reviews, on this app";
    case "not_found":
      return "check the id or the app: health lists the apps and packages this server reaches";
    case "input":
      return "fix what the message names and call again; nothing was changed";
    case "rate_limited":
      return "the store is throttling these credentials; wait a minute and retry";
    case "outcome_unknown":
      return "the reply may already be public: read the review again (it shows its reply) before sending it again";
    case "api":
      return error.status === 0 ? "the store was unreachable; retry later" : "the store failed; retry in a minute, and check its status page if it persists";
    case "drift":
      return "the store answered in a shape this server does not know; its API changed, and the server's adapter needs updating (report it with the message)";
  }
};
