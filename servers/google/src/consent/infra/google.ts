import { type Granted, makeOAuthClient } from "@foreverworks/mcp-kit";

import type { ClientConfig } from "../../domain/credentials.js";
import type { TokenInfo } from "../../domain/tokenInfo.js";
import { makeGetJson } from "../../infra/httpJson.js";
import { asAuthFailure } from "../../infra/oauth.js";
import { makeTokenInfo } from "../../infra/tokenInfo.js";

/** Google's authorization endpoint. */
export const AUTH_URI = "https://accounts.google.com/o/oauth2/auth";

/**
 * The default loopback redirect. Nothing listens there: the redirect fails to
 * load, and the URL it tried is read from the browser's address bar. A Desktop
 * app OAuth client accepts any loopback port.
 */
export const DEFAULT_REDIRECT_URI = "http://localhost:8123/";

/** The code for a grant, on the client the authorization was asked on (the kit's RFC 6749 client). */
export const exchangeCode = (client: ClientConfig, code: string, redirectUri: string, verifier: string): Promise<Granted> =>
  makeOAuthClient({ tokenUri: client.tokenUri, clientId: client.clientId, clientSecret: client.clientSecret, fail: asAuthFailure }).authorizationCode(
    code,
    redirectUri,
    verifier,
  );

/** Who a brand-new access token belongs to, asked of tokeninfo with that token and nothing else. */
export const whoApproved = (accessToken: string): Promise<TokenInfo> =>
  makeTokenInfo(makeGetJson({ get: async () => accessToken, force: async () => accessToken }))(accessToken);
