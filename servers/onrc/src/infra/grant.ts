import { join } from "node:path";

import { type BearerTokens, type Minted, makeTokenSource, type OAuthClient, type TokenStore, withFileLock } from "@foreverworks/mcp-kit";

import type { Clock, SessionPort } from "../app/ports.js";
import { asAppError, fail, needsLogin } from "../domain/errors.js";
import { isRefreshExpired, REFRESH_SKEW_S, type Session, sessionFrom } from "../domain/session.js";
import { makeSessionFile } from "./grant/sessionFile.js";
import { issuedOf } from "./oauthClient.js";

/**
 * The session, on the kit's token source (packages/mcp-kit, tokens.ts):
 * memory, then session.json, then ONE refresh for every caller waiting, under
 * a lock the service and any CLI copy share.
 *
 * What is Keycloak's is the minting. A refresh may rotate the refresh token,
 * so `mint` writes the whole new session to session.json BEFORE it returns,
 * inside the lock. A refresh Keycloak refuses as `invalid_grant` is the end of
 * the session: the file is kept but marked expired now, so session_status
 * says "expired" rather than "never connected", and the failure is
 * `needs_login`.
 */
export const makeGrant = (options: { readonly stateDir: string; readonly client: OAuthClient; readonly now: Clock }) => {
  const { stateDir, client, now } = options;
  const file = makeSessionFile(join(stateDir, "session.json"));
  const locked = <T>(fn: () => Promise<T>): Promise<T> => withFileLock(stateDir, "session.lock", fn, { staleMs: 60_000 });

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

  const current = async (): Promise<Session> =>
    (await file.read()) ?? fail(needsLogin("never_connected", "no session is stored; nobody has signed in through this server yet"));

  const mint = async (): Promise<Minted> => {
    const before = await current();
    if (isRefreshExpired(before, now())) fail(needsLogin("expired", "the session's refresh token is past the expiry Keycloak gave it"));
    const granted = await client.refresh(before.refreshToken).catch(async (thrown: unknown) => {
      const failure = asAppError(thrown);
      if (failure?.kind === "needs_login") await file.write({ ...before, refreshExpEpoch: now() });
      throw thrown;
    });
    const next = sessionFrom(issuedOf(granted), now(), before) ?? fail(needsLogin("refused", "Keycloak refreshed without a refresh token; the session cannot be kept"));
    await file.write(next);
    return { token: next.accessToken, expiresAtEpoch: next.accessExpEpoch, scope: next.scope };
  };

  const source = makeTokenSource({ mint, store, skewSeconds: REFRESH_SKEW_S, nowEpoch: now });

  const session: SessionPort = {
    read: file.read,
    rotate: async () => {
      await source.rotate();
      return current();
    },
    replace: async (next) => {
      await locked(() => file.write(next));
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
