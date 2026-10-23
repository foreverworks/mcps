import { CODE_LIFETIME_MS, typedCode } from "../../domain/codes.js";
import { isoAt } from "../../domain/dates.js";
import { type AppError, asAppError, fail, inputError } from "../../domain/errors.js";
import { type Cookies, isPendingLive, pendingExpiresAtMs, sameCookies, type Session, sessionView } from "../../domain/session.js";
import type { CodeWatch, Deps, Site } from "../ports.js";

/**
 * Signing in, which this server does by itself:
 *
 *   1. start watching the mailbox (so the code that comes next is told from
 *      the ones already there),
 *   2. read the credential and send it; SPV e-mails a code,
 *   3. wait for the new code and send it; the cookies are the session.
 *
 * If no mail source can read the code, or it does not come in time, the
 * F5 session that asked for it is kept as a pending login and the caller is
 * told to pass the code to complete_login within SPV's five minutes.
 */

const needsCode = (reason: "awaiting_code" | "code_not_received", message: string, expiresAtMs: number): AppError => ({
  kind: "needs_login",
  reason,
  message,
  expires_at: isoAt(expiresAtMs),
});

/** SPV itself (pfinternet): the site every tool but the filing ones works on. */
const spv = (deps: Deps): Site => ({ name: "SPV", login: deps.login, store: deps.store });

const established = async (deps: Deps, site: Site, cookies: Cookies, username: string): Promise<Session> => {
  const now = deps.now();
  const session: Session = { cookies, username, signedInAtMs: now, lastOkAtMs: now };
  await site.store.write(session);
  await site.store.clearPending();
  return session;
};

/**
 * Sign in now. `replacing`: the session the caller saw die (`null` when none
 * was stored). If what is stored by the time the lock is held is another
 * session, another caller signed in meanwhile and it is taken as it is: two
 * callers that both met a dead session make SPV send one code, not two.
 */
export const signIn = (deps: Deps, options: { readonly replacing?: Cookies | null; readonly byHand?: boolean } = {}): Promise<Session> => signInAt(deps, spv(deps), options);

/**
 * Sign in to `site` with the same credential and code source. The lock is
 * the same for every site: they e-mail their codes from one address.
 */
const signInAt = (deps: Deps, site: Site, options: { readonly replacing?: Cookies | null; readonly byHand?: boolean } = {}): Promise<Session> =>
  deps.exclusive(async () => {
    const { replacing, byHand = false } = options;
    if (replacing !== undefined) {
      const current = await site.store.read();
      if (current !== undefined && (replacing === null || !sameCookies(current.cookies, replacing))) return current;
    }
    const credentials = await deps.credentials.read();
    const watch: CodeWatch | undefined = byHand ? undefined : await deps.codes.watch();
    try {
      const outcome = await site.login.submitPassword(await site.login.begin(), credentials);
      if (outcome.kind === "refused") return fail({ kind: "login_refused", step: "password", message: `${site.name}: ${outcome.message}` });
      if (outcome.kind === "signed_in") return await established(deps, site, outcome.cookies, credentials.username);
      const pending = { cookies: outcome.cookies, username: credentials.username, startedAtMs: deps.now() };
      await site.store.writePending(pending);
      const expiresAtMs = pendingExpiresAtMs(pending);
      if (watch === undefined) {
        const why = byHand ? "code_by_hand was asked" : deps.codes.info.driver === "manual" ? deps.codes.info.why : "no mail source is configured";
        return fail(needsCode("awaiting_code", `SPV e-mailed a security code and ${why}`, expiresAtMs));
      }
      const code = await watch.next(Math.min(expiresAtMs, deps.now() + deps.codeWaitMs));
      if (code === undefined) {
        return fail(needsCode("code_not_received", `no new security code showed up in the mailbox within ${Math.round(deps.codeWaitMs / 1000)} s`, expiresAtMs));
      }
      const done = await site.login.submitCode(outcome.cookies, code);
      if (done.kind === "refused") {
        await site.store.clearPending();
        return fail({ kind: "login_refused", step: "code", message: `${site.name}: ${done.message}` });
      }
      return await established(deps, site, done.cookies, credentials.username);
    } finally {
      await watch?.close();
    }
  });

/**
 * Run a page operation on the stored session; if SPV has ended it, sign in
 * once and run it again. A second expiry is not retried: it is reported.
 */
export const withSession = <T>(deps: Deps, op: () => Promise<T>): Promise<T> => withSessionAt(deps, spv(deps), op);

/** withSession on another site (formularespv-pf). A sign-in there that waits for a code by hand is reported, not completed: call again. */
export const withSessionAt = async <T>(deps: Deps, site: Site, op: () => Promise<T>): Promise<T> => {
  const before = await site.store.read();
  try {
    return await op();
  } catch (thrown) {
    if (asAppError(thrown)?.kind !== "session_expired") throw thrown;
  }
  await signInAt(deps, site, { replacing: before?.cookies ?? null });
  return op();
};

/** The login tool: sign in now unless a working session is stored (or `force`). */
export const login = async (deps: Deps, args: { readonly force: boolean; readonly byHand: boolean }) => {
  if (!args.force && !args.byHand) {
    const stored = await deps.store.read();
    if (stored !== undefined) {
      const alive = await deps.portal.probe().then(
        () => true,
        (thrown: unknown) => (asAppError(thrown)?.kind === "session_expired" ? false : Promise.reject(thrown)),
      );
      const current = (await deps.store.read()) ?? stored;
      if (alive) return { ok: true as const, signed_in: true as const, already: true as const, session: sessionView(current, deps.now()) };
    }
  }
  try {
    const session = await signIn(deps, { byHand: args.byHand });
    return { ok: true as const, signed_in: true as const, already: false as const, code_via: args.byHand ? "complete_login" : deps.codes.info.driver, session: sessionView(session, deps.now()) };
  } catch (thrown) {
    const error = asAppError(thrown);
    if (error?.kind !== "needs_login") throw thrown;
    return {
      ok: true as const,
      signed_in: false as const,
      awaiting_code: true as const,
      reason: error.reason,
      message: error.message,
      expires_at: error.expires_at,
      next: "read the newest \"Cod de siguranta\" mail from Autentificare.SpatiuPrivat@anaf.ro and pass its digits to complete_login before expires_at",
    };
  }
};

/** Finish a sign-in that is waiting for its code, with the code a person or an agent read from the mailbox. */
export const completeLogin = async (deps: Deps, args: { readonly code: string }) => {
  const code = typedCode(args.code) ?? fail(inputError("code must be the digits from the mail (\"Cod de siguranta: 123456\" -> 123456)"));
  return deps.exclusive(async () => {
    const pending = await deps.store.readPending();
    if (pending === undefined) return fail(inputError("no sign-in is waiting for a code; call login first"));
    if (!isPendingLive(pending, deps.now())) {
      await deps.store.clearPending();
      return fail({ kind: "needs_login", reason: "pending_expired", message: `the code was due by ${isoAt(pendingExpiresAtMs(pending))}; SPV no longer accepts it` });
    }
    const done = await deps.login.submitCode(pending.cookies, code);
    if (done.kind === "refused") {
      await deps.store.clearPending();
      return fail({ kind: "login_refused", step: "code", message: done.message });
    }
    const session = await established(deps, spv(deps), done.cookies, pending.username);
    return { ok: true as const, signed_in: true as const, session: sessionView(session, deps.now()) };
  });
};

/** Sign out at SPV and forget the session here. */
export const logout = async (deps: Deps) =>
  deps.exclusive(async () => {
    const stored = await deps.store.read();
    if (stored !== undefined) await deps.login.end(stored.cookies).catch(() => undefined);
    await deps.store.clear();
    await deps.store.clearPending();
    return { ok: true as const, signed_in: false as const, forgot: stored !== undefined };
  });

/** What is stored; `probe` loads one page to prove SPV still honours it. Never signs in. */
export const sessionStatus = async (deps: Deps, args: { readonly probe: boolean }) => {
  const stored = await deps.store.read();
  const pending = await deps.store.readPending();
  const waiting = pending !== undefined && isPendingLive(pending, deps.now()) ? { awaiting_code_until: isoAt(pendingExpiresAtMs(pending)) } : {};
  if (stored === undefined) return { ok: true as const, signed_in: false as const, ...waiting, next: "any tool signs in by itself; login does it now" };
  if (!args.probe) return { ok: true as const, signed_in: true as const, probed: false as const, session: sessionView(stored, deps.now()), ...waiting };
  const alive = await deps.portal.probe().then(
    () => true,
    (thrown: unknown) => (asAppError(thrown)?.kind === "session_expired" ? false : Promise.reject(thrown)),
  );
  const current = (await deps.store.read()) ?? stored;
  return alive
    ? { ok: true as const, signed_in: true as const, probed: true as const, session: sessionView(current, deps.now()), ...waiting }
    : { ok: true as const, signed_in: false as const, probed: true as const, expired: true as const, next: "any tool signs in again by itself; login does it now" };
};

/** How long a pending code stays usable, for descriptions. */
export const CODE_MINUTES = Math.round(CODE_LIFETIME_MS / 60_000);
