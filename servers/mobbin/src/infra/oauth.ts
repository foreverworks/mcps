import { discoverOAuth, liveFetch, makeOAuthClient, type OAuthFailure, registerPublicClient } from "@foreverworks/mcp-kit";

import type { OAuthPort } from "../app/ports.js";
import { authorizationError, fail, notAuthorized } from "../domain/errors.js";
import type { ClientRegistration } from "../domain/schema.js";

const discovery = (message: string): never => fail({ kind: "discovery", message });

const clientFor = (client: ClientRegistration, failure: (f: OAuthFailure) => never, fetchImpl: typeof fetch) =>
  makeOAuthClient({
    tokenUri: client.tokenEndpoint,
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
    fail: failure,
    fetch: fetchImpl,
    // A code and a rotating refresh token are single-use: never resend after a lost answer.
    singleUse: true,
  });

/** The sign-in service: discovered at run time, registered with once, and its token endpoint for the code and for refreshes. */
export const makeOAuth = (fetchImpl: typeof fetch = liveFetch): OAuthPort => ({
  discover: (upstreamUrl) => discoverOAuth({ resourceUrl: upstreamUrl, fail: discovery, fetch: fetchImpl }),
  register: (endpoints, redirectUri, scope, clientName) =>
    registerPublicClient({
      registrationEndpoint: endpoints.registrationEndpoint ?? discovery(`${endpoints.issuer} offers no dynamic client registration`),
      clientName,
      redirectUris: [redirectUri],
      scope,
      fail: discovery,
      fetch: fetchImpl,
    }),
  exchange: (client, code, verifier) =>
    clientFor(
      client,
      (failure) =>
        failure.kind === "unreachable"
          ? fail({ kind: "unreachable", message: `Mobbin's sign-in service could not be reached: ${failure.message}` })
          : fail(authorizationError(`Mobbin refused the code (${failure.error}): ${failure.description}`)),
      fetchImpl,
    ).authorizationCode(code, client.redirectUri, verifier),
  refresh: (client, refreshToken) =>
    clientFor(
      client,
      (failure) =>
        failure.kind === "unreachable"
          ? fail({ kind: "unreachable", message: `Mobbin's sign-in service could not be reached or is busy: ${failure.message}; the grant is kept, retry later` })
          : failure.error === "invalid_grant" || failure.error === "invalid_client"
            ? fail(notAuthorized(`Mobbin refused the refresh token (${failure.error}): ${failure.description}`, true))
            : // Anything else (429, 5xx, temporarily_unavailable) is Mobbin being unwell: the grant is still good.
              fail({ kind: "upstream", message: `Mobbin's sign-in service did not accept the refresh (${failure.error}, status ${String(failure.status)}); the grant is kept, retry later` }),
      fetchImpl,
    ).refresh(refreshToken),
});
