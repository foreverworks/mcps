import {
  epochNow,
  fileTokenStore,
  makeOAuthClient,
  makeTokenSource,
  mintedFrom,
  type OAuthFailure,
  type Sleep,
  type TokenSource,
} from "@foreverworks/mcp-kit";

import { apiError, authError, fail } from "../domain/errors.js";
import type { AppConfig } from "./config.js";

/**
 * Oblio's access token: OAuth2 client credentials (https://www.oblio.eu/api,
 * Autorizare: client_id is the login email, client_secret the API secret), on
 * the kit's grant client and token source. In memory, then in the state dir's
 * `access_token.json` (atomic, 0600, locked across processes), then ONE mint
 * for everyone waiting. A token lives an hour; every mint spends a request
 * against the same throttle every other call does.
 */

/** Refused credentials need a human; an unwell or unreachable endpoint does not. */
const asGrantFailure = (failure: OAuthFailure): never => {
  if (failure.kind === "unreachable") return fail(apiError(0, `Oblio's token endpoint: ${failure.message}`));
  if (failure.status === 429 || failure.status >= 500)
    return fail(apiError(failure.status, `Oblio's token endpoint is unwell (HTTP ${failure.status}): ${failure.description}`));
  return fail(authError(`Oblio refused the credentials (${failure.error}): ${failure.description}`));
};

export type TokenOptions = {
  /** Epoch seconds. */
  readonly nowEpoch?: () => number;
  readonly sleep?: Sleep;
};

export const makeOblioTokens = (
  config: () => Promise<AppConfig>,
  stateDir: string,
  { nowEpoch = epochNow, sleep }: TokenOptions = {},
): TokenSource =>
  makeTokenSource({
    store: fileTokenStore(stateDir),
    nowEpoch,
    mint: async () => {
      const c = await config();
      const client = makeOAuthClient({
        tokenUri: c.tokenUrl,
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        fail: asGrantFailure,
        ...(sleep === undefined ? {} : { sleep }),
      });
      return mintedFrom(await client.clientCredentials(), nowEpoch());
    },
  });
