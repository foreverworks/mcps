import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit,
 * errors.ts): no classes, no `instanceof`, so a failure survives
 * serialisation and a module boundary.
 *
 * The one every tool but the login tools can raise is `needs_login`: the
 * portal's session belongs to the person signed in, lives only as long as
 * Keycloak lets it, and comes back only through their browser. The remedy for it is the
 * server's whole point: it says what to call, never "contact support".
 */
export type AppError =
  /** The stored session cannot be read as one. Nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /**
   * No session, or one Keycloak no longer honours: never connected, the refresh token expired
   * or was revoked, or the portal answered 401 to a fresh token. `reason` says which.
   */
  | { readonly kind: "needs_login"; readonly reason: "never_connected" | "expired" | "revoked" | "refused"; readonly message: string }
  /** The session works but this account may not do that (another user's filing). */
  | { readonly kind: "forbidden"; readonly message: string }
  /** No such filing, note or document, as the portal looked it up. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The arguments cannot become a request, or the portal refused them as invalid. */
  | { readonly kind: "input"; readonly message: string }
  /** Still 429 after the retries. */
  | { readonly kind: "rate_limited"; readonly message: string }
  /** The portal or Keycloak was unreachable or unwell (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** The portal answered, but not in the shape this server was written against. */
  | { readonly kind: "drift"; readonly message: string };

export type Kind = AppError["kind"];

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const needsLogin = (reason: Extract<AppError, { kind: "needs_login" }>["reason"], message: string): AppError => ({ kind: "needs_login", reason, message });

export const { fail, asAppError } = makeErrorKit<AppError>("onrc");

/**
 * What to do about it, in one sentence. The login sentence is built once
 * (loginRemedy) so that `config`, `needs_login` and the tool descriptions all
 * say the same thing; the deployment may add the command that does it all.
 */
export const remedyFor = (error: AppError, loginHelp: string): string => {
  switch (error.kind) {
    case "config":
      return "delete the session file the message names, then sign in again with begin_login and complete_login";
    case "needs_login":
      return loginHelp;
    case "forbidden":
      return "the signed-in account may not do this; a filing is visible only to the account that made it";
    case "not_found":
      return "check the id (list_requests gives a filing's id, get_request its documents); nothing else was changed";
    case "input":
      return "fix what the message names and call again; nothing was changed";
    case "rate_limited":
      return "the portal is throttling this session; wait a minute and retry";
    case "api":
      return error.status === 0 ? "the portal or its sign-in server was unreachable; retry later" : "the portal failed; retry later, and read its home page banner if it persists";
    case "drift":
      return "the portal's API changed under this server (an answer no longer has the fields it had); the server needs updating, report it with the message";
  }
};

/**
 * The sentence for a session that needs the user's browser. `script`, when
 * the deployment names one (ONRC_LOGIN_SCRIPT), is the command that begins
 * the login, brings the user the link and completes it; the two tools are
 * named either way.
 */
export const loginRemedy = (script: string | undefined): string =>
  (script
    ? `run \`${script}\`: it begins the login, brings the user the link to open in their signed-in browser, and completes it; or, by hand: `
    : "") +
  "call begin_login (it answers with a URL and a deadline), have the USER open that URL in the browser where they are signed in to the portal, " +
  "and pass the address the browser lands on (code=... and state=... in it) to complete_login; no password or code is typed anywhere";
