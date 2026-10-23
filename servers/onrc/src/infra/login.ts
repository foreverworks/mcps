import { join } from "node:path";

import { authorizeUrl, type OAuthClient } from "@foreverworks/mcp-kit";

import type { LoginPort } from "../app/ports.js";
import { type AppConfig, endpoints } from "./config.js";
import { makePendingStore } from "./login/pendingStore.js";
import { issuedOf } from "./oauthClient.js";

/**
 * The authorization-code flow's adapter: Keycloak's authorize URL (with
 * `response_mode=query`, so the code lands in the query string of a static
 * page and can be read off the address bar), the code exchange through the
 * same OAuth client the refresh uses, the end-session call, and the begun
 * login in the state dir.
 */
export const makeLogin = (options: { readonly config: AppConfig; readonly client: OAuthClient; readonly fetch?: typeof fetch }): LoginPort => {
  const { config, client } = options;
  const doFetch = options.fetch ?? fetch;
  const urls = endpoints(config.issuer);
  return {
    redirectUri: config.redirectUri,
    authorizeUrl: (state, pkce) =>
      authorizeUrl({
        authUri: urls.authorize,
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        scopes: config.scopes,
        state,
        pkce: { verifier: "", challenge: pkce.challenge, method: pkce.method },
        extra: { response_mode: "query" },
      }),
    exchangeCode: async (code, redirectUri, verifier) => issuedOf(await client.authorizationCode(code, redirectUri, verifier)),
    // RFC 7009-style: Keycloak ends the SSO session the refresh token belongs to. A refusal
    // (the token already dead) is the outcome wanted, so nothing is thrown.
    endSession: async (refreshToken) => {
      try {
        await doFetch(urls.logout, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: config.clientId, refresh_token: refreshToken }).toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // unreachable: the local session is forgotten either way
      }
    },
    pending: makePendingStore(join(config.stateDir, "login.json"), config.stateDir),
  };
};
