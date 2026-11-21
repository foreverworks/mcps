import { authorizeUrl, newPkce, newState, offerLink, parseRedirect } from "@foreverworks/mcp-kit";

import { AUTHORIZATION_TTL_S, isoOf, matchPending, scopeFor } from "../../domain/authorization.js";
import { authorizationError, fail, inputError } from "../../domain/errors.js";
import type { ClientRegistration } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

/**
 * Step one: the page to open in a browser where the person is signed in to
 * Mobbin. Registers this server as a client of Mobbin's sign-in service when
 * it has not, or when the sign-in service or the redirect address changed
 * since; remembers the PKCE verifier and the state, which only the returning
 * address can complete.
 */
export const beginAuthorization = async (deps: Deps) => {
  const { config, oauth, stores, now } = deps;
  const endpoints = await oauth.discover(config.upstreamUrl);
  const scope = scopeFor(endpoints, config.scope);
  const held = await stores.client.read();
  const reusable =
    held !== undefined &&
    held.issuer === endpoints.issuer &&
    held.redirectUri === config.redirectUri &&
    held.scope === scope &&
    held.authorizationEndpoint === endpoints.authorizationEndpoint &&
    held.tokenEndpoint === endpoints.tokenEndpoint;
  // A new registration waits in `candidate` until the sign-in completes: client.json is what the
  // working grant refreshes with, so it is not touched before then.
  const client: ClientRegistration = reusable ? held : await register(deps, endpoints, scope);
  if (reusable) await stores.candidate.clear();
  else await stores.candidate.write(client);

  const pkce = newPkce();
  const state = newState();
  const createdAtEpoch = now();
  await stores.pending.write({ state, redirectUri: config.redirectUri, verifier: pkce.verifier, createdAtEpoch });
  const url = authorizeUrl({ authUri: client.authorizationEndpoint, clientId: client.clientId, redirectUri: config.redirectUri, scopes: scope.split(" "), state, pkce });
  offerLink({
    url,
    message:
      "Open this in a browser where you are signed in to Mobbin and allow access. The browser then goes to an address with code= in it (the page itself may fail to load): " +
      "paste that whole address into this conversation within ten minutes.",
    next: "the person has Mobbin's page open; ask them for the whole address the browser lands on and pass it to complete_authorization as redirect_url.",
  });
  return {
    ok: true,
    authorize_url: url,
    redirect_uri: config.redirectUri,
    scope,
    open_until: isoOf(createdAtEpoch + AUTHORIZATION_TTL_S),
    next:
      "Open authorize_url in a browser where you are signed in to Mobbin and allow access. The browser then lands on redirect_uri with ?code=...&state=... in the address " +
      "(the page itself may fail to load; the address is what matters). Pass that whole address to complete_authorization as redirect_url.",
  };
};

const register = async (deps: Deps, endpoints: Awaited<ReturnType<Deps["oauth"]["discover"]>>, scope: string): Promise<ClientRegistration> => {
  if (endpoints.registrationEndpoint === undefined) return fail({ kind: "discovery", message: `${endpoints.issuer} offers no dynamic client registration` });
  const registered = await deps.oauth.register(endpoints, deps.config.redirectUri, scope, deps.config.clientName);
  return {
    issuer: endpoints.issuer,
    clientId: registered.clientId,
    ...(registered.clientSecret === undefined ? {} : { clientSecret: registered.clientSecret }),
    redirectUri: deps.config.redirectUri,
    authorizationEndpoint: endpoints.authorizationEndpoint,
    tokenEndpoint: endpoints.tokenEndpoint,
    scope,
  };
};

/**
 * Step two: the address the browser landed on (or its code). The state is
 * checked BEFORE the code is spent, and the code is spent once. The tokens go
 * straight to the state directory; the caller learns when the access token
 * ends and whether a refresh token came with it.
 */
export const completeAuthorization = async (deps: Deps, args: { readonly redirectUrl: string }) => {
  const { stores, oauth, now } = deps;
  const redirect = parseRedirect(args.redirectUrl);
  if (redirect.kind === "invalid") return fail(inputError(`that is not the address the browser landed on: ${redirect.message}`));
  if (redirect.kind === "refused") return fail(authorizationError(`Mobbin refused the sign-in: ${redirect.error}${redirect.description === undefined ? "" : ` (${redirect.description})`}`));
  const pending = matchPending(await stores.pending.read(), redirect.state, now());
  const candidate = await stores.candidate.read();
  const client = candidate ?? (await stores.client.read());
  if (client === undefined) return fail(authorizationError("no client is registered: call begin_authorization first"));

  const granted = await oauth.exchange(client, redirect.code, pending.verifier);
  await stores.pending.clear();
  const refreshToken = granted.refreshToken;
  if (refreshToken === undefined) {
    // Without a refresh token the grant would end within the hour. A grant that works already is left as it is.
    return fail(authorizationError("Mobbin granted access but no refresh token, so the grant would end within the hour and was not stored (any earlier grant is kept); call begin_authorization again, and if this repeats MOBBIN_SCOPE must include offline_access"));
  }
  const expiresAtEpoch = now() + granted.expiresInSeconds;
  // The new client is promoted with the new grant, never before: the old grant refreshes with the old one.
  if (candidate !== undefined) {
    await stores.client.write(candidate);
    await stores.candidate.clear();
  }
  await stores.grant.write({ accessToken: granted.accessToken, refreshToken, expiresAtEpoch, ...(granted.scope === undefined ? {} : { scope: granted.scope }) });
  const tools = await deps.upstream.listTools().then(
    async (listed) => {
      await deps.rememberTools(listed);
      return listed.length;
    },
    () => undefined,
  );
  return { ok: true, access_expires_at: isoOf(expiresAtEpoch), refreshable: true, ...(tools === undefined ? {} : { upstream_tools: tools }) };
};
