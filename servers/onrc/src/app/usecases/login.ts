import { newPkce, newState, offerLink, parseRedirect } from "@foreverworks/mcp-kit";

import { fail, inputError, loginRemedy, needsLogin } from "../../domain/errors.js";
import { expiresAtEpoch, matchPending } from "../../domain/login.js";
import { describeSession, isoOf, isRefreshExpired, type Session, sessionFrom } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/**
 * Step one: the page the user opens. The state and the PKCE verifier are
 * remembered in the state dir; complete_login accepts only an address that
 * carries the state back. Nothing is spent yet. Where the client can offer
 * the URL to its user itself (MCP URL elicitation), it does, and the result
 * then tells the model only what comes next.
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
      "Open this in the browser where you are signed in to myportal.onrc.ro; nothing is typed. It ends on a blank page: " +
      "copy that page's whole address and paste it into this conversation at once, as the portal's code dies within a minute.",
    next:
      "the user has the sign-in page open in the browser where they are signed in to the portal; ask them for the whole address of " +
      `the blank page it ends on (${login.redirectUri}?...code=...&state=...) and pass it to complete_login as redirect_url at once: ` +
      "Keycloak's code dies within a minute.",
  });
  return {
    ok: true as const,
    url,
    redirect_uri: login.redirectUri,
    expires_at: isoOf(expiresAtEpoch(pending)),
    next:
      "the USER opens url in the browser where they are signed in to the portal (Keycloak answers from that sign-in; nothing is typed). " +
      `The browser then lands on ${login.redirectUri}?...code=...&state=... (a blank page). Pass that whole address to complete_login as redirect_url ` +
      "within a minute: Keycloak's code dies quickly.",
  };
};

/**
 * Step two: the address the browser landed on. The state is checked BEFORE
 * the code is spent, the code is spent once, and the session goes straight to
 * the state dir; the caller learns who signed in and two expiry dates.
 */
export const completeLogin = async (deps: Deps, args: { readonly redirectUrl: string }) => {
  const { login, session, now } = deps;
  const redirect = parseRedirect(args.redirectUrl);
  if (redirect.kind === "invalid") return fail(inputError(`not the address of a finished login: ${redirect.message}`));
  const pending = matchPending(await login.pending.read(), redirect.state ?? "", now());
  if (redirect.kind === "refused") {
    await login.pending.clear();
    return fail(inputError(`Keycloak answered ${redirect.error}${redirect.description ? ` (${redirect.description})` : ""}: the login did not happen`));
  }
  const issued = await login.exchangeCode(redirect.code, pending.redirectUri, pending.verifier);
  const next = sessionFrom(issued, now()) ?? fail(needsLogin("refused", "Keycloak granted an access token without a refresh token; the session could not be kept"));
  await session.replace(next);
  await login.pending.clear();
  return { ok: true as const, connected: true as const, who: who(deps, next), ...describeSession(next, now()) };
};

/** Who the session belongs to, from the access token's claims; nothing of the token itself. */
const who = ({ claimsOf }: Deps, s: Session) => {
  const c = claimsOf(s.accessToken);
  return { username: c.username ?? null, name: c.name ?? null, email: c.email ?? null };
};

/**
 * What is stored right now, without touching Keycloak; `probe` refreshes once
 * to prove the session is alive, which is what "is it still signed in" means.
 */
export const sessionStatus = async (deps: Deps, args: { readonly probe: boolean }) => {
  const { session, now, loginScript } = deps;
  const stored = await session.read();
  if (stored === undefined) {
    return { ok: true as const, connected: false as const, reason: "never_connected" as const, next: loginRemedy(loginScript) };
  }
  if (isRefreshExpired(stored, now())) {
    return { ok: true as const, connected: false as const, reason: "expired" as const, ...describeSession(stored, now()), next: loginRemedy(loginScript) };
  }
  const current = args.probe ? await session.rotate() : stored;
  return { ok: true as const, connected: true as const, probed: args.probe, who: who(deps, current), ...describeSession(current, now()) };
};

/** Forget the session here and, best effort, at Keycloak. The user's own browser sign-in is not touched. */
export const logout = async (deps: Deps) => {
  const { session, login } = deps;
  const stored = await session.read();
  if (stored !== undefined) await login.endSession(stored.refreshToken);
  await session.forget();
  await login.pending.clear();
  return { ok: true as const, connected: false as const, forgot: stored !== undefined };
};
