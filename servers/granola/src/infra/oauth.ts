import { discoverOAuth, liveFetch, makeOAuthClient, type OAuthFailure, registerPublicClient } from "@foreverworks/mcp-kit";

import type { OAuthPort } from "../app/ports.js";
import { authorizationError, fail, notAuthorized } from "../domain/errors.js";
import { onSameSite } from "../domain/origins.js";
import type { ClientRegistration } from "../domain/schema.js";
import { refusingRedirects } from "./fetch.js";

const discovery = (message: string): never => fail({ kind: "discovery", message });

const clientFor = (client: ClientRegistration, failure: (f: OAuthFailure) => never, fetchImpl: typeof fetch, resource: string) =>
  makeOAuthClient({
    tokenUri: client.tokenEndpoint,
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
    fail: failure,
    fetch: refusingRedirects(fetchImpl),
    // Granola ties a token to the resource it was asked for, on the code and on every refresh.
    extraForm: { resource },
    // A code and a rotating refresh token are single-use: never resend after a lost answer.
    singleUse: true,
  });

/**
 * The sign-in service: discovered at run time, registered with once, and its
 * token endpoint for the code and for refreshes. `resource` is the MCP server's
 * own address, sent with every token request.
 */
export const makeOAuth = (resource: string, fetchImpl: typeof fetch = liveFetch): OAuthPort => ({
  discover: async (upstreamUrl) => {
    const found = await discoverOAuth({ resourceUrl: upstreamUrl, fail: discovery, fetch: refusingRedirects(fetchImpl) });
    // A credential goes only where the MCP server's own site says, never to an address a document merely names.
    for (const endpoint of [found.issuer, found.authorizationEndpoint, found.tokenEndpoint, found.registrationEndpoint]) {
      if (endpoint !== undefined && !onSameSite(upstreamUrl, endpoint)) return discovery(`${endpoint} is not an https address on the same site as ${upstreamUrl}`);
    }
    return found;
  },
  register: (endpoints, redirectUri, scope, clientName) =>
    registerPublicClient({
      registrationEndpoint: endpoints.registrationEndpoint ?? discovery(`${endpoints.issuer} offers no dynamic client registration`),
      clientName,
      redirectUris: [redirectUri],
      scope,
      fail: discovery,
      fetch: refusingRedirects(fetchImpl),
    }),
  exchange: (client, code, verifier) =>
    clientFor(
      client,
      (failure) =>
        failure.kind === "unreachable"
          ? fail({ kind: "unreachable", message: `Granola's sign-in service could not be reached: ${failure.message}` })
          : fail(authorizationError(`Granola refused the code (${failure.error}): ${failure.description}`)),
      fetchImpl,
      resource,
    ).authorizationCode(code, client.redirectUri, verifier),
  refresh: (client, refreshToken) =>
    clientFor(
      client,
      (failure) =>
        failure.kind === "unreachable"
          ? fail({ kind: "unreachable", message: `Granola's sign-in service could not be reached or is busy: ${failure.message}; the grant is kept, retry later` })
          : failure.error === "invalid_grant" || failure.error === "invalid_client"
            ? fail(notAuthorized(`Granola refused the refresh token (${failure.error}): ${failure.description}`, true))
            : // Anything else (429, 5xx, temporarily_unavailable) is Granola being unwell: the grant is still good.
              fail({ kind: "upstream", message: `Granola's sign-in service did not accept the refresh (${failure.error}, status ${String(failure.status)}); the grant is kept, retry later` }),
      fetchImpl,
      resource,
    ).refresh(refreshToken),
});
