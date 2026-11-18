import { fail, inputError } from "./errors.js";

/**
 * The two ways in, both through eSănătateaMea's own Keycloak (the portal's
 * public client), so both end in the same kind of session:
 *
 * - **password**: Keycloak's own form, the account's e-mail and password and
 *   then the six digits of its authenticator app. The server fills the form
 *   itself; when it can read the code too (a vault, a TOTP secret) nobody is
 *   asked anything. When it cannot, the form waits at the code step
 *   (`PendingCode`) until complete_login brings the digits.
 * - **ROeID**: the state's digital identity. Keycloak hands the browser to
 *   ROeID (`kc_idp_hint=roeid`), whose risk engine wants a real browser and
 *   whose push lands on the user's phone, so this leg runs where the user is:
 *   begin_login mints a `state` and a PKCE verifier and remembers them
 *   (`PendingLogin`), the user signs in with ROeID and approves on the phone,
 *   the browser lands on the redirect URI with `code` and `state`, and
 *   complete_login accepts that address only if its `state` is the one
 *   remembered.
 *
 * The agent sees a URL, a question for six digits and two expiry dates,
 * never a token.
 */
export type PendingLogin = {
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly createdAtEpoch: number;
};

/** A browser cookie as the sign-in form's jar holds it. */
export type Cookie = { readonly name: string; readonly value: string; readonly domain: string; readonly hostOnly: boolean; readonly path: string };

/**
 * A password sign-in stopped at the code step: Keycloak's half-finished
 * login (its cookies and the form's action), and the PKCE pair the code will
 * be exchanged with. Keycloak forgets it after a few minutes; so does
 * matchPendingCode.
 */
export type PendingCode = PendingLogin & { readonly action: string; readonly cookies: readonly Cookie[] };

/**
 * How long a begun ROeID login stays open. The user has to notice a
 * notification, sign in, approve on the phone and hand over an address, so
 * minutes; Keycloak's own clock is the code's one minute, which starts only
 * once they have.
 */
export const LOGIN_TTL_S = 15 * 60;

/** Keycloak's login form lives five minutes by default (the realm's "login timeout"); a code asked for after that meets a dead form. */
export const CODE_TTL_S = 5 * 60;

export const expiresAtEpoch = (p: PendingLogin): number => p.createdAtEpoch + LOGIN_TTL_S;

export const codeExpiresAtEpoch = (p: PendingCode): number => p.createdAtEpoch + CODE_TTL_S;

/**
 * The pending login that `state` answers, or a refusal. A state that does not
 * match is a stale tab or someone else's redirect, and either way the code
 * must not be spent.
 */
export const matchPending = (pending: PendingLogin | undefined, state: string, nowEpoch: number): PendingLogin => {
  if (pending === undefined) return fail(inputError('no ROeID login is in progress; call begin_login with method "roeid" first'));
  if (state !== pending.state) return fail(inputError("the state in that address is not the one begin_login issued; call begin_login again and open the new URL"));
  if (nowEpoch > expiresAtEpoch(pending)) return fail(inputError("that login was begun more than 15 minutes ago; call begin_login again"));
  return pending;
};

/** The password sign-in waiting for its code, or why there is none to finish. */
export const matchPendingCode = (pending: PendingCode | undefined, nowEpoch: number): PendingCode => {
  if (pending === undefined) return fail(inputError('no password sign-in is waiting for a code; call begin_login with method "password" first'));
  if (nowEpoch > codeExpiresAtEpoch(pending)) return fail(inputError("the sign-in form waited more than 5 minutes for its code and Keycloak has dropped it; call begin_login again"));
  return pending;
};

/** Six digits, as an authenticator app shows them (spaces allowed, as some apps group them 3 and 3). */
export const otpOf = (raw: string): string => {
  const digits = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : fail(inputError("the code is the six digits the authenticator app shows for this account"));
};
