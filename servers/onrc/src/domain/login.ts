import { fail, inputError } from "./errors.js";

/**
 * The one manual step, split so an agent can run it without ever holding the
 * session: begin_login mints a `state` and a PKCE verifier and remembers them
 * in the state dir; the user opens Keycloak's page in the browser where they
 * are already signed in (Keycloak answers from its SSO cookie, so no password
 * is typed); the browser lands on the registered redirect URI with `code` and
 * `state`; complete_login accepts that address only if its `state` is the one
 * remembered, exchanges the code with the verifier, and stores the session.
 * The agent sees a URL and two expiry dates, never a token.
 */
export type PendingLogin = {
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly createdAtEpoch: number;
};

/**
 * How long a begun login stays open. The user has to notice a notification
 * and click once, so minutes; Keycloak's own clock is the code's one minute,
 * which starts only once they have.
 */
export const LOGIN_TTL_S = 15 * 60;

export const expiresAtEpoch = (p: PendingLogin): number => p.createdAtEpoch + LOGIN_TTL_S;

/**
 * The pending login that `state` answers, or a refusal. A state that does not
 * match is a stale tab or someone else's redirect, and either way the code
 * must not be spent.
 */
export const matchPending = (pending: PendingLogin | undefined, state: string, nowEpoch: number): PendingLogin => {
  if (pending === undefined) return fail(inputError("no login is in progress; call begin_login first"));
  if (state !== pending.state) return fail(inputError("the state in that address is not the one begin_login issued; call begin_login again and open the new URL"));
  if (nowEpoch > expiresAtEpoch(pending)) return fail(inputError("that login was begun more than 15 minutes ago; call begin_login again"));
  return pending;
};
