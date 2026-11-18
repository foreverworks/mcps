import { join } from "node:path";

import { type BearerTokens, type Minted, makeTokenSource, newPkce, newState, type OAuthClient, type TokenStore, withFileLock } from "@foreverworks/mcp-kit";

import type { Clock, CredentialSource, LoginPort, SessionPort } from "../app/ports.js";
import { asAppError, fail, needsLogin } from "../domain/errors.js";
import { isoOf, isRefreshExpired, REFRESH_SKEW_S, type Session, sessionFrom } from "../domain/session.js";
import { makeRefusalFile, makeSessionFile } from "./grant/sessionFile.js";
import { issuedOf } from "./oauthClient.js";

/**
 * How long a refused password or code is left alone. Keycloak counts failed
 * sign-ins and locks the account after a few; a server that tried on every
 * call would get there in a minute. A person who fixed it does not wait:
 * session_status with probe tries again at once.
 */
export const REFUSAL_PAUSE_S = 15 * 60;

/**
 * The session, on the kit's token source (packages/mcp-kit, tokens.ts):
 * memory, then session.json, then ONE mint for every caller waiting, under a
 * lock the service and any CLI copy share.
 *
 * Minting is a refresh while the session lives. eSănătateaMea's Keycloak
 * rotates the refresh token on every refresh, so the new session is written
 * before the mint returns. When there is no session, or Keycloak refuses the
 * refresh (`invalid_grant`), it is a sign-in through the password form, the
 * password and the code read just then and never kept. With no code source
 * the form stops at the authenticator step, which is remembered for
 * complete_login and answered `needs_code`. With no password configured it is
 * `needs_login`, and the file is kept but marked expired so session_status
 * says "expired" rather than "never connected". A password or code Keycloak
 * refuses is `login_refused`, remembered so the next REFUSAL_PAUSE_S of calls
 * do not send it again.
 */
export const makeGrant = (options: {
  readonly stateDir: string;
  readonly client: OAuthClient;
  readonly login: LoginPort;
  readonly credentials: CredentialSource;
  readonly now: Clock;
  readonly random: (bytes: number) => Uint8Array;
}) => {
  const { stateDir, client, login, credentials, now, random } = options;
  const file = makeSessionFile(join(stateDir, "session.json"));
  const refusal = makeRefusalFile(join(stateDir, "signin-refused.json"));
  const locked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(stateDir, "session.lock", fn, { staleMs: 90_000 });

  const store: TokenStore = {
    read: async () => {
      const s = await file.read();
      return s === undefined ? undefined : { token: s.accessToken, expiresAtEpoch: s.accessExpEpoch, scope: s.scope };
    },
    // `mint` has already written this token with the rest of the session, and the file is
    // dropped by `forget` below, not by the kit: `source.forget()` must be able to drop the
    // cached token alone after a login replaced the file.
    write: async () => undefined,
    withLock: locked,
  };

  const remembered = async <T>(run: () => Promise<T>): Promise<T> =>
    run().catch(async (thrown: unknown) => {
      const failure = asAppError(thrown);
      if (failure?.kind === "login_refused") await refusal.write({ atEpoch: now(), message: failure.message });
      throw thrown;
    });

  const signIn = async (): Promise<Session> => {
    const paused = await refusal.read();
    if (paused !== undefined && now() < paused.atEpoch + REFUSAL_PAUSE_S) {
      return fail({
        kind: "login_refused",
        message: `Keycloak refused the sign-in at ${isoOf(paused.atEpoch)} (${paused.message}); it is not tried again before ${isoOf(paused.atEpoch + REFUSAL_PAUSE_S)}, or until session_status is called with probe`,
      });
    }
    const pkce = newPkce(random);
    const begun = { state: newState(random), verifier: pkce.verifier, redirectUri: login.redirectUri, createdAtEpoch: now() };
    const step = await remembered(async () => login.passwordForm(begun, await credentials.read()));
    let code: string;
    if (step.kind === "code") code = step.code;
    else {
      const source = credentials.code;
      if (source === undefined) {
        await login.pendingCode.write(step.pending);
        return fail({ kind: "needs_code", message: "the password was accepted and Keycloak asks for the authenticator's six-digit code, which nothing here can read" });
      }
      const otp = await source.read();
      code = await remembered(() => login.submitCode(step.pending, otp));
    }
    const issued = await login.exchangeCode(code, begun.redirectUri, begun.verifier);
    const next = sessionFrom(issued, now(), "password") ?? fail(needsLogin("refused", "Keycloak signed in without a refresh token; the session could not be kept"));
    await file.write(next);
    await refusal.clear();
    await login.pendingCode.clear();
    return next;
  };

  const refreshed = async (before: Session): Promise<Session | undefined> => {
    const granted = await client.refresh(before.refreshToken).catch(async (thrown: unknown) => {
      const failure = asAppError(thrown);
      if (failure?.kind !== "needs_login") throw thrown;
      await file.write({ ...before, refreshExpEpoch: now() });
      if (!credentials.configured) throw thrown;
      return undefined;
    });
    if (granted === undefined) return undefined;
    const next = sessionFrom(issuedOf(granted), now(), before.via, before) ?? fail(needsLogin("refused", "Keycloak refreshed without a refresh token; the session cannot be kept"));
    await file.write(next);
    return next;
  };

  /** A refresh while the session lives, else a sign-in with the password, else needs_login saying why. */
  const nextSession = async (before: Session | undefined): Promise<Session> => {
    if (before !== undefined && !isRefreshExpired(before, now())) return (await refreshed(before)) ?? signIn();
    if (credentials.configured) return signIn();
    if (before === undefined) return fail(needsLogin("never_connected", "no session is stored and no password is configured; nobody has signed in through this server yet"));
    return fail(needsLogin("expired", "the session is over, and no password is configured to sign in again"));
  };

  const mint = async (): Promise<Minted> => {
    const next = await nextSession(await file.read());
    return { token: next.accessToken, expiresAtEpoch: next.accessExpEpoch, scope: next.scope };
  };

  const source = makeTokenSource({ mint, store, skewSeconds: REFRESH_SKEW_S, nowEpoch: now });

  const current = async (): Promise<Session> =>
    (await file.read()) ?? fail(needsLogin("never_connected", "no session is stored; nobody has signed in through this server yet"));

  const session: SessionPort = {
    read: file.read,
    rotate: async () => {
      await locked(refusal.clear);
      await source.rotate();
      return current();
    },
    signIn: async () => {
      const next = await locked(async () => {
        await refusal.clear();
        return signIn();
      });
      await source.forget();
      return next;
    },
    replace: async (next) => {
      await locked(async () => {
        await file.write(next);
        await refusal.clear();
        await login.pendingCode.clear();
      });
      await source.forget();
    },
    forget: async () => {
      await locked(file.clear);
      await source.forget();
    },
  };
  const access: BearerTokens = { get: source.get, force: source.force };
  return { session, access } as const;
};
