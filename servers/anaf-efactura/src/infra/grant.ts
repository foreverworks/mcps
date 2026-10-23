import { type BearerTokens, type Minted, makeTokenSource, type OAuthClient, type TokenStore, withFileLock } from "@foreverworks/mcp-kit";

import type { Clock, TokensPort } from "../app/ports.js";
import { authError, fail } from "../domain/errors.js";
import { bundleFrom, isRefreshExpired, REFRESH_SKEW_S } from "../domain/tokens.js";
import { makeTokensFile } from "./grant/tokensFile.js";
import { mintedOf } from "./oauthClient.js";

/**
 * The grant, on the kit's token source (packages/mcp-kit, tokens.ts): memory,
 * then tokens.json, then ONE refresh for every caller waiting, under a lock
 * the service, the daily --refresh job and any stdio copy all share.
 *
 * What is ANAF's is the minting. A refresh answers with a new refresh token as
 * well, and ANAF's procedure says both must be saved; so `mint` writes the
 * whole new pair to tokens.json BEFORE it returns, inside the lock, and a
 * rotated refresh token is never held only in memory. It also refuses to spend
 * a refresh token past its expiry: ANAF would answer invalid_grant, and saying
 * so here costs no call.
 *
 * tokens.json is the one place the access token lives too: the store the kit
 * reads is a view of it, not a second file.
 */
export const makeGrant = (options: {
  readonly tokensPath: string;
  readonly stateDir: string;
  readonly client: () => Promise<OAuthClient>;
  readonly now: Clock;
}) => {
  const { tokensPath, stateDir, client, now } = options;
  const file = makeTokensFile(tokensPath);

  const store: TokenStore = {
    read: async () => {
      const b = await file.readOptional();
      return b === undefined ? undefined : { token: b.accessToken, expiresAtEpoch: b.accessTokenExpEpoch, scope: b.scope };
    },
    // `mint` has already written this token with the rest of its pair; a
    // write of anything else would be a second source of truth, so none happens.
    write: async (minted) => {
      const b = await file.read();
      if (b.accessToken !== minted.token) await file.write({ ...b, accessToken: minted.token, accessTokenExpEpoch: minted.expiresAtEpoch });
    },
    withLock: (fn) => withFileLock(stateDir, "tokens.lock", fn, { staleMs: 60_000 }),
  };

  const mint = async (): Promise<Minted> => {
    const current = await file.read();
    if (isRefreshExpired(current, now()))
      fail(authError("refresh_expired", "the refresh token is past its expiry; no automatic recovery exists"));
    const next = bundleFrom(mintedOf(await (await client()).refresh(current.refreshToken)), now(), current);
    await file.write(next);
    return { token: next.accessToken, expiresAtEpoch: next.accessTokenExpEpoch, scope: next.scope };
  };

  const source = makeTokenSource({ mint, store, skewSeconds: REFRESH_SKEW_S, nowEpoch: now });

  const tokens: TokensPort = {
    read: file.read,
    // Always mints (the kit's rotate): the refresh_token tool with force, and
    // the maintenance window, refresh while the stored token is still fresh.
    rotate: async () => {
      await source.rotate();
      return file.read();
    },
    replace: (bundle) => store.withLock(() => file.write(bundle)),
  };
  const access: BearerTokens = { get: source.get, force: source.force };
  return { tokens, access } as const;
};
