import { bearer, epochNow, makeOAuthClient, makeTokenSource, memoryTokenStore, mintedFrom, type HttpAuth, type OAuthFailure, type Sleep } from "@foreverworks/mcp-kit";

import { fail } from "../../domain/errors.js";
import { SOURCE, type EuipoCredentials } from "./credentials.js";

/** Refused credentials need a human; an unwell or unreachable endpoint does not. */
const asGrantFailure = (failure: OAuthFailure): never => {
  if (failure.kind === "unreachable") return fail({ kind: "api", source: SOURCE, status: 0, message: `EUIPO's token endpoint: ${failure.message}` });
  if (failure.status === 429 || failure.status >= 500)
    return fail({ kind: "api", source: SOURCE, status: failure.status, message: `EUIPO's token endpoint is unwell (HTTP ${failure.status}): ${failure.description}` });
  return fail({ kind: "auth", source: SOURCE, status: failure.status, message: `EUIPO refused the client credentials (${failure.error}): ${failure.description}` });
};

/**
 * OAuth2 client credentials, scope `uid` (the spec's Oauth2ClientCredentials),
 * on the kit's grant client and token source. A token lives two hours and is
 * kept in memory only: minting one is a single request, and it grants no
 * access to anyone's data. Every request also names the client in `X-IBM-Client-Id`,
 * the gateway's own check.
 */
export const makeEuipoAuth = (
  credentials: () => Promise<EuipoCredentials>,
  tokenUri: string,
  { fetch: injected, sleep }: { readonly fetch?: typeof fetch; readonly sleep?: Sleep } = {},
): HttpAuth => {
  const tokens = makeTokenSource({
    store: memoryTokenStore(),
    mint: async () => {
      const { clientId, clientSecret } = await credentials();
      const client = makeOAuthClient({
        tokenUri,
        clientId,
        clientSecret,
        fail: asGrantFailure,
        ...(injected === undefined ? {} : { fetch: injected }),
        ...(sleep === undefined ? {} : { sleep }),
      });
      return mintedFrom(await client.clientCredentials("uid"), epochNow());
    },
  });
  const auth = bearer(tokens);
  return {
    // The credentials first: without them the failure is "not configured", not a refused token request.
    headers: async () => ({ "X-IBM-Client-Id": (await credentials()).clientId, ...(await auth.headers()) }),
    renew: tokens.force,
  };
};
