import { type Granted, makeOAuthClient, type OAuthClient, type OAuthFailure, type Sleep } from "@foreverworks/mcp-kit";

import { authError, fail } from "../domain/errors.js";
import { ACCESS_TOKEN_LIFETIME_S, type Issued } from "../domain/tokens.js";
import type { AppConfig } from "./config.js";
import { claimsOf } from "./oauthClient/claims.js";

/** A refused grant is the grant's failure (permanent for invalid_grant); anything else is the network's. */
const asAuthFailure = (failure: OAuthFailure): never =>
  fail(failure.kind === "grant_refused" ? authError(failure.error, failure.description) : authError("network_error", failure.message));

/**
 * ANAF's token endpoint, through the kit's OAuth client (packages/mcp-kit,
 * oauth.ts): the client as HTTP Basic, and `token_content_type=jwt` on every
 * grant, as ANAF's procedure asks, so the access token is a JWT whose claims
 * can be read.
 */
export const anafOAuthClient = (config: AppConfig, { sleep }: { readonly sleep?: Sleep } = {}): OAuthClient =>
  makeOAuthClient({
    tokenUri: config.endpoints.token,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    clientAuth: "basic",
    extraForm: { token_content_type: "jwt" },
    defaultExpiresIn: ACCESS_TOKEN_LIFETIME_S,
    fail: asAuthFailure,
    ...(sleep ? { sleep } : {}),
  });

/** What a grant amounts to, with the claims read out of its access token. */
export const mintedOf = (granted: Granted): Issued => {
  const claims = claimsOf(granted.accessToken);
  return {
    accessToken: granted.accessToken,
    refreshToken: granted.refreshToken,
    tokenType: typeof granted.raw["token_type"] === "string" ? granted.raw["token_type"] : undefined,
    expiresIn: granted.expiresInSeconds,
    scope: granted.scope,
    accessExpEpoch: claims.exp,
    serial: claims.serial,
    issuer: claims.issuer,
    roles: claims.roles,
  };
};
