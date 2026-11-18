import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit,
 * errors.ts): no classes, no `instanceof`, so a failure survives
 * serialisation and a module boundary.
 *
 * Three of them are about signing in. `needs_login` is a session that is gone
 * and no way here to make a new one by itself: the remedy names the login
 * tools. `needs_code` is a password sign-in that reached the authenticator
 * step with no code source configured: the user reads six digits off their
 * phone. `login_refused` is a password or code Keycloak said no to: sending it
 * again unchanged only brings the account closer to Keycloak's lockout, so its
 * remedy says to fix it first.
 */
export type AppError =
  /** A setting is missing or cannot be used (a password file, the vault's settings, a corrupt session file). Nothing was sent. */
  | { readonly kind: "config"; readonly message: string }
  /**
   * No session and no password to make one: never connected, the refresh token expired
   * or was revoked, or the portal answered 401 to a fresh token. `reason` says which.
   */
  | { readonly kind: "needs_login"; readonly reason: "never_connected" | "expired" | "revoked" | "refused"; readonly message: string }
  /** The password was accepted and Keycloak asks for the authenticator's code, which nothing here can read. */
  | { readonly kind: "needs_code"; readonly message: string }
  /** Keycloak refused the password or the code, or asks for a step this server cannot take (a new password, terms to accept). */
  | { readonly kind: "login_refused"; readonly message: string }
  /** The session works but the portal will not show this to this account. */
  | { readonly kind: "forbidden"; readonly message: string }
  /** No such document, as the portal looked it up. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The arguments cannot become a request, or the portal refused them as invalid. */
  | { readonly kind: "input"; readonly message: string }
  /** Still 429 after the retries. */
  | { readonly kind: "rate_limited"; readonly message: string }
  /** The portal or Keycloak was unreachable or unwell (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** The portal answered, but not in the shape this server was written against. */
  | { readonly kind: "drift"; readonly message: string }
  /** The vault MCP server the password or the code is read from failed. */
  | { readonly kind: "upstream"; readonly source: "vault"; readonly message: string };

export type Kind = AppError["kind"];

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string): AppError => ({ kind: "input", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });
export const loginRefused = (message: string): AppError => ({ kind: "login_refused", message });
export const needsLogin = (reason: Extract<AppError, { kind: "needs_login" }>["reason"], message: string): AppError => ({ kind: "needs_login", reason, message });
export const upstreamError = (source: "vault", message: string): AppError => ({ kind: "upstream", source, message });

export const { fail, asAppError } = makeErrorKit<AppError>("esanatateamea");

/**
 * What to do about it, in one sentence. The login sentence is built once
 * (loginRemedy) so that `needs_login` and the tool descriptions say the same
 * thing; the deployment may add the command that runs the ROeID leg.
 */
export const remedyFor = (error: AppError, loginHelp: string): string => {
  switch (error.kind) {
    case "config":
      return "fix the setting the message names (README, Configuration) and call again; nothing was sent to the portal";
    case "needs_login":
      return loginHelp;
    case "needs_code":
      return "ask the user for the six digits their authenticator app shows for eSănătateaMea now, and pass them to complete_login as otp within a few minutes";
    case "login_refused":
      return "do NOT call again until the cause in the message is fixed (the password or the authenticator key in the vault, or a step to finish once on the portal): Keycloak locks an account after repeated failures; ROeID (begin_login with method roeid) still works meanwhile";
    case "forbidden":
      return "the signed-in account may not see this; the portal shows a person only their own records";
    case "not_found":
      return "check the id (list_medical_documents gives a document's id); nothing was changed";
    case "input":
      return "fix what the message names and call again; nothing was changed";
    case "rate_limited":
      return "the portal is throttling this session; wait a minute and retry";
    case "api":
      return error.status === 0 ? "the portal or its sign-in server was unreachable; retry later" : "the portal failed; retry later, and read its home page banner if it persists";
    case "drift":
      return "the portal's API changed under this server (an answer no longer has the fields it had); the server needs updating, report it with the message";
    case "upstream":
      return "the vault MCP server the password and code are read from failed: check that it runs and that the vault item the settings name exists, then call again";
  }
};

/**
 * The sentence for a session that needs the user. With a password
 * configured the server signs in by itself and this is rarely said; `script`,
 * when the deployment names one (ESANATATEAMEA_LOGIN_SCRIPT), is the command
 * that runs the ROeID leg end to end.
 */
export const loginRemedy = (script: string | undefined): string =>
  (script ? `run \`${script}\`: it begins a ROeID login, brings the user the page and the phone approval, and completes it; or, by hand: ` : "") +
  'call begin_login with method "password" (the server signs in with the configured e-mail and password, and asks for the authenticator code only if it cannot read it), ' +
  'or with method "roeid": the USER opens the URL it gives, signs in with ROeID and approves on their phone, and the address the browser lands on goes to complete_login as redirect_url';
