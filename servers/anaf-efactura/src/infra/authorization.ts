import { join } from "node:path";

import { newState, type OAuthClient } from "@foreverworks/mcp-kit";

import type { AuthorizationPort } from "../app/ports.js";
import type { AppConfig } from "./config.js";
import { makePendingStore } from "./authorization/pendingStore.js";
import { mintedOf } from "./oauthClient.js";

/**
 * The page the certificate holder opens. `token_content_type=jwt` goes on this leg too, as
 * ANAF's procedure asks.
 */
export const authorizeUrl = (config: AppConfig, redirectUri: string, state: string): string =>
  `${config.endpoints.authorize}?${new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    token_content_type: "jwt",
    state,
  }).toString()}`;

/**
 * `code` and `state` out of the address the browser landed on. Takes a full
 * URL or just its query string, since that is what a person copies.
 */
export const fromRedirect = (address: string): { readonly code: string | undefined; readonly state: string | undefined } => {
  const trimmed = address.trim();
  const query = trimmed.includes("?") ? trimmed.slice(trimmed.indexOf("?") + 1) : trimmed;
  const params = new URLSearchParams(query.split("#")[0] ?? "");
  return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
};

/**
 * The authorization-code flow's adapter: ANAF's authorize URL, the code
 * exchange through the same OAuth client the refresh uses, and the begun
 * authorization in the state dir.
 */
export const makeAuthorization = (options: {
  readonly config: () => Promise<AppConfig>;
  readonly client: () => Promise<OAuthClient>;
  readonly stateDir: string;
}): AuthorizationPort => {
  const { config, client, stateDir } = options;
  return {
    redirectUris: async () => (await config()).redirectUris,
    authorizeUrl: async (redirectUri, state) => authorizeUrl(await config(), redirectUri, state),
    exchangeCode: async (code, redirectUri) => mintedOf(await (await client()).authorizationCode(code, redirectUri)),
    fromRedirect,
    newState: () => newState(),
    pending: makePendingStore(join(stateDir, "authorization.json"), stateDir),
  };
};
