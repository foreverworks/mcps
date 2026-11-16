import { newPkce, newState, offerLink, parseRedirect } from "@foreverworks/mcp-kit";

import { fail, inputError, loginRemedy, needsLogin } from "../../domain/errors.js";
import { expiresAtEpoch, matchPending } from "../../domain/login.js";
import { describeSession, goneReasonOf, isoOf, type Session, sessionFrom } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/**
 * Signing in through the browser, for an account with no password here (or
 * one that signs in with Google or a passkey). Step one: the page the user
 * opens. The state and the PKCE verifier are remembered in the state dir;
 * complete_login accepts only an address that carries the state back.
 * Where the client can offer the URL to its user itself (MCP URL
 * elicitation), it does, and the result then tells the model only what
 * comes next.
 */
export const beginLogin = async (deps: Deps) => {
  const { login, now, random } = deps;
  const pkce = newPkce(random);
  const state = newState(random);
  const pending = { state, verifier: pkce.verifier, redirectUri: login.redirectUri, createdAtEpoch: now() };
  await login.pending.write(pending);
  const url = login.authorizeUrl(state, pkce);
  offerLink({
    url,
    message:
      "Open this and sign in to eToll as you do on portal.etoll.ro. It ends on a page of plain text (one of the portal's script files): " +
      "copy that page's whole address and paste it into this conversation at once, as the code in it dies within a minute.",
    next:
      "the user has the eToll sign-in page open; ask them for the whole address of the page it ends on " +
      `(${login.redirectUri}?...code=...&state=...) and pass it to complete_login as redirect_url at once: Keycloak's code dies within a minute.`,
  });
  return {
    ok: true as const,
    url,
    redirect_uri: login.redirectUri,
    expires_at: isoOf(expiresAtEpoch(pending)),
    next:
      "the USER opens url in their browser and signs in to eToll there (their password never reaches this conversation). " +
      `The browser then lands on ${login.redirectUri}?...code=...&state=... (a page of plain text). Pass that whole address to complete_login as redirect_url ` +
      "within a minute: Keycloak's code dies quickly.",
  };
};

/**
 * Step two: the address the browser landed on. The state is checked BEFORE
 * the code is spent, the code is spent once, and the session goes straight to
 * the state dir; the caller learns who signed in and the expiry dates.
 */
export const completeLogin = async (deps: Deps, args: { readonly redirectUrl: string }) => {
  const { login, session, now } = deps;
  const redirect = parseRedirect(args.redirectUrl);
  if (redirect.kind === "invalid") return fail(inputError(`not the address of a finished sign-in: ${redirect.message}`));
  const pending = matchPending(await login.pending.read(), redirect.state ?? "", now());
  if (redirect.kind === "refused") {
    await login.pending.clear();
    return fail(inputError(`Keycloak answered ${redirect.error}${redirect.description ? ` (${redirect.description})` : ""}: the sign-in did not happen`));
  }
  const issued = await login.exchangeCode(redirect.code, pending.redirectUri, pending.verifier);
  const next = sessionFrom(issued, now(), "browser") ?? fail(needsLogin("refused", "Keycloak granted an access token without a refresh token; the session could not be kept"));
  await session.replace(next);
  await login.pending.clear();
  return { ok: true as const, connected: true as const, who: whoOf(deps, next), ...describeSession(next, now()) };
};

/** Who the session belongs to, from the access token's claims; nothing of the token itself. */
const whoOf = ({ claimsOf }: Deps, s: Session) => {
  const c = claimsOf(s.accessToken);
  return { username: c.username ?? null, name: c.name ?? null, email: c.email ?? null };
};

/**
 * What is stored right now, without touching Keycloak. `probe` mints once to
 * prove the session is alive: a refresh, or with a password configured a
 * sign-in, which also lifts the pause after a refused password.
 */
export const sessionStatus = async (deps: Deps, args: { readonly probe: boolean }) => {
  const { session, now, loginScript, credentials } = deps;
  const passwordSignIn = credentials.configured;
  const stored = await session.read();
  const gone = goneReasonOf(stored, now());
  if (gone !== undefined && !(args.probe && passwordSignIn)) {
    return {
      ok: true as const,
      connected: false as const,
      reason: gone,
      password_sign_in: passwordSignIn,
      ...(stored === undefined ? {} : describeSession(stored, now())),
      next: passwordSignIn ? "the server signs in with the configured password at the next call that needs eToll; session_status with probe does it now" : loginRemedy(loginScript),
    };
  }
  const current = args.probe ? await session.rotate() : (stored ?? fail(needsLogin("never_connected", "no session is stored")));
  return { ok: true as const, connected: true as const, probed: args.probe, password_sign_in: passwordSignIn, who: whoOf(deps, current), ...describeSession(current, now()) };
};

/**
 * Forget the session here and, best effort, at Keycloak. With a password
 * configured the next call signs in again; to stop that, remove the password
 * setting too.
 */
export const logout = async (deps: Deps) => {
  const { session, login, credentials } = deps;
  const stored = await session.read();
  if (stored !== undefined) await login.endSession(stored.refreshToken);
  await session.forget();
  await login.pending.clear();
  return {
    ok: true as const,
    connected: false as const,
    forgot: stored !== undefined,
    ...(credentials.configured ? { note: "a password is still configured, so the next call that needs eToll signs in again; remove it to stay signed out" } : {}),
  };
};
