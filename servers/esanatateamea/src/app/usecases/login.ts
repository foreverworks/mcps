import { newPkce, newState, offerLink, parseRedirect } from "@foreverworks/mcp-kit";

import { asAppError, fail, inputError, loginRemedy, needsLogin } from "../../domain/errors.js";
import { codeExpiresAtEpoch, expiresAtEpoch, matchPending, matchPendingCode, otpOf } from "../../domain/login.js";
import { describeSession, goneReasonOf, isoOf, type Session, sessionFrom } from "../../domain/session.js";
import type { Deps } from "../ports.js";

/** Who the session belongs to, from the access token's claims; nothing of the token itself. */
const whoOf = ({ claimsOf }: Deps, s: Session) => {
  const c = claimsOf(s.accessToken);
  return { username: c.username ?? null, name: c.name ?? null, email: c.email ?? null };
};

const connected = (deps: Deps, s: Session) => ({ ok: true as const, connected: true as const, who: whoOf(deps, s), ...describeSession(s, deps.now()) });

/**
 * The password leg: the server fills Keycloak's form with the configured
 * e-mail and password and, when it can read the authenticator code, finishes
 * by itself. When it cannot, the form waits at the code step and the answer
 * says so: the user reads six digits off their phone for complete_login.
 */
const beginPassword = async (deps: Deps) => {
  if (!deps.credentials.configured) return fail(inputError('no password is configured for this server (README, Configuration); use method "roeid" instead'));
  try {
    return { ...connected(deps, await deps.session.signIn()), via: "password" as const };
  } catch (thrown) {
    if (asAppError(thrown)?.kind !== "needs_code") throw thrown;
    const pending = await deps.login.pendingCode.read();
    return {
      ok: true as const,
      connected: false as const,
      needs_code: true as const,
      expires_at: pending === undefined ? null : isoOf(codeExpiresAtEpoch(pending)),
      next: "ask the USER for the six digits their authenticator app shows for eSănătateaMea now, and pass them to complete_login as otp before expires_at",
    };
  }
};

/**
 * The ROeID leg: the page the user opens. The state and the PKCE verifier are
 * remembered in the state dir; complete_login accepts only an address that
 * carries the state back. Where the client can offer the URL to its user
 * itself (MCP URL elicitation), it does, and the result then tells the model
 * only what comes next.
 */
const beginRoeid = async (deps: Deps) => {
  const { login, now, random } = deps;
  const pkce = newPkce(random);
  const state = newState(random);
  const pending = { state, verifier: pkce.verifier, redirectUri: login.redirectUri, createdAtEpoch: now() };
  await login.pending.write(pending);
  const url = login.authorizeUrl(state, pkce, "roeid");
  offerLink({
    url,
    message:
      "Open this, sign in with ROeID and approve the request in the ROeID app on your phone; the first time, ROeID asks to share your details with eSănătateaMea: choose Acceptă. " +
      "It ends on a page of plain text (one of the portal's files): " +
      "copy that page's whole address and paste it into this conversation at once, as the code in it dies within a minute.",
    next:
      "the user has the ROeID sign-in open; ask them for the whole address of the page it ends on " +
      `(${login.redirectUri}?...code=...&state=...) and pass it to complete_login as redirect_url at once: Keycloak's code dies within a minute.`,
  });
  return {
    ok: true as const,
    url,
    redirect_uri: login.redirectUri,
    expires_at: isoOf(expiresAtEpoch(pending)),
    next:
      "the USER opens url in a real browser, signs in with ROeID (their password never reaches this conversation) and approves the push in the ROeID app; " +
      "the first time ROeID asks their consent to share their details with eSănătateaMea, which they must accept (Acceptă), or the sign-in ends without a code. " +
      `The browser then lands on ${login.redirectUri}?...code=...&state=... (a page of plain text). Pass that whole address to complete_login as redirect_url ` +
      "within a minute: Keycloak's code dies quickly.",
  };
};

export const beginLogin = (deps: Deps, args: { readonly method: "password" | "roeid" }) => (args.method === "password" ? beginPassword(deps) : beginRoeid(deps));

/**
 * Finishing either leg: the authenticator's code for a password sign-in that
 * stopped there, or the address a ROeID sign-in landed on. For the address,
 * the state is checked BEFORE the code is spent, the code is spent once, and
 * the session goes straight to the state dir.
 */
export const completeLogin = async (deps: Deps, args: { readonly otp?: string | undefined; readonly redirectUrl?: string | undefined }) => {
  const { login, session, now } = deps;
  if ((args.otp === undefined) === (args.redirectUrl === undefined)) {
    return fail(inputError("pass exactly one: otp (the authenticator's six digits, after a password sign-in) or redirect_url (the address a ROeID sign-in landed on)"));
  }
  if (args.otp !== undefined) {
    const otp = otpOf(args.otp);
    const pending = matchPendingCode(await login.pendingCode.read(), now());
    // Keycloak answers a wrong code with a new form whose action this server did not keep, so the
    // begun sign-in is spent either way. A person's typo is not a reason to pause the password.
    const code = await login.submitCode(pending, otp).catch(async (thrown: unknown) => {
      const failure = asAppError(thrown);
      if (failure?.kind !== "login_refused") throw thrown;
      await login.pendingCode.clear();
      return fail(inputError(`${failure.message}; that sign-in is spent: call begin_login with method "password" again and pass the new six digits`));
    });
    await login.pendingCode.clear();
    const issued = await login.exchangeCode(code, pending.redirectUri, pending.verifier);
    const next = sessionFrom(issued, now(), "password") ?? fail(needsLogin("refused", "Keycloak granted an access token without a refresh token; the session could not be kept"));
    await session.replace(next);
    return { ...connected(deps, next), via: "password" as const };
  }
  const redirect = parseRedirect(args.redirectUrl ?? "");
  if (redirect.kind === "invalid") return fail(inputError(`not the address of a finished sign-in: ${redirect.message}`));
  const pending = matchPending(await login.pending.read(), redirect.state ?? "", now());
  if (redirect.kind === "refused") {
    await login.pending.clear();
    return fail(inputError(`Keycloak answered ${redirect.error}${redirect.description ? ` (${redirect.description})` : ""}: the sign-in did not happen`));
  }
  const issued = await login.exchangeCode(redirect.code, pending.redirectUri, pending.verifier);
  const next = sessionFrom(issued, now(), "roeid") ?? fail(needsLogin("refused", "Keycloak granted an access token without a refresh token; the session could not be kept"));
  await session.replace(next);
  await login.pending.clear();
  return { ...connected(deps, next), via: "roeid" as const };
};

/**
 * What is stored right now, without touching Keycloak. `probe` mints once to
 * prove the session is alive: a refresh, or with a password configured a
 * sign-in, which also lifts the pause after a refused password.
 */
export const sessionStatus = async (deps: Deps, args: { readonly probe: boolean }) => {
  const { session, now, loginScript, credentials } = deps;
  const passwordSignIn = credentials.configured;
  const automatic = passwordSignIn && credentials.code !== undefined;
  const stored = await session.read();
  const gone = goneReasonOf(stored, now());
  if (gone !== undefined && !(args.probe && passwordSignIn)) {
    return {
      ok: true as const,
      connected: false as const,
      reason: gone,
      password_sign_in: passwordSignIn,
      automatic_code: automatic,
      ...(stored === undefined ? {} : describeSession(stored, now())),
      next: automatic
        ? "the server signs in with the configured password and code at the next call that needs the portal; session_status with probe does it now"
        : loginRemedy(loginScript),
    };
  }
  const current = args.probe ? await session.rotate() : (stored ?? fail(needsLogin("never_connected", "no session is stored")));
  return { ...connected(deps, current), probed: args.probe, password_sign_in: passwordSignIn, automatic_code: automatic };
};

/**
 * Forget the session here and, best effort, at Keycloak. With a password and
 * a code source configured the next call signs in again; to stop that,
 * remove the password setting too.
 */
export const logout = async (deps: Deps) => {
  const { session, login, credentials } = deps;
  const stored = await session.read();
  if (stored !== undefined) await login.endSession(stored.refreshToken);
  await session.forget();
  await login.pending.clear();
  await login.pendingCode.clear();
  return {
    ok: true as const,
    connected: false as const,
    forgot: stored !== undefined,
    ...(credentials.configured ? { note: "a password is still configured, so the next call that needs the portal signs in again; remove it to stay signed out" } : {}),
  };
};
