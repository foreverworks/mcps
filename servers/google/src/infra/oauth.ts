import { makeOAuthClient, makeTokenSource, mintedFrom, type OAuthFailure, type TokenStore } from "@foreverworks/mcp-kit";

import { authError, fail } from "../domain/errors.js";
import { splitScopes } from "../domain/scopes.js";
import type { Credentials } from "./credentials.js";

/** A refused grant is the grant's failure (permanent for invalid_grant); anything else is the network's. */
export const asAuthFailure = (failure: OAuthFailure): never =>
  fail(failure.kind === "grant_refused" ? authError(failure.error, failure.description) : authError("network_error", failure.message));

/**
 * Access tokens for one grant: the kit's OAuth refresh grant and token source
 * (packages/mcp-kit, oauth.ts and tokens.ts), in memory, then in the store,
 * then minted once for everyone who is waiting.
 */
export const makeTokenProvider = (loadCreds: () => Promise<Credentials>, store: TokenStore) => {
  const source = makeTokenSource({
    store,
    mint: async () => {
      const creds = await loadCreds();
      const client = makeOAuthClient({ tokenUri: creds.tokenUri, clientId: creds.clientId, clientSecret: creds.clientSecret, fail: asAuthFailure });
      // Google answers a refresh with the scope the token carries. Recording it is what lets a
      // write refuse on a read-only grant without a round trip to tokeninfo first.
      return mintedFrom(await client.refresh(creds.refreshToken), Math.floor(Date.now() / 1000));
    },
  });
  /**
   * The scope the live token carries, as the issuer stated it at mint time.
   * An entry written by an older build has none recorded, and one forced
   * refresh fills it in rather than guessing.
   */
  const scope = async (): Promise<string> => {
    const known = (await source.current()).scope;
    if (known !== undefined) return known;
    await source.force();
    return (await source.current()).scope ?? "";
  };
  return {
    get: source.get,
    force: source.force,
    scope,
    /** The same, as a list. */
    scopes: async (): Promise<readonly string[]> => splitScopes(await scope()),
    /** Drop every token of this grant, in memory and on disk: it was replaced by a re-consent. */
    forget: source.forget,
  } as const;
};

export type TokenProvider = ReturnType<typeof makeTokenProvider>;
