import { fileTokenStore } from "@foreverworks/mcp-kit";

import { loadCredentials } from "../infra/credentials.js";
import { makeGetJson, makeRequest, type Request } from "../infra/httpJson.js";
import { makeTokenProvider } from "../infra/oauth.js";
import { makeTokenInfo } from "../infra/tokenInfo.js";
import type { GrantSpec } from "./registry.js";

/** One account's grant, described without its secrets. */
export type Grant = {
  readonly account: string;
  /** The address the grant must resolve to: the one its consent recorded. */
  readonly address?: string;
  readonly credentials: string;
  /** What the issuer said the live token grants. */
  readonly scopes: () => Promise<readonly string[]>;
  /** The address Google says the live token belongs to (the consent asks for userinfo.email). */
  readonly whoami: () => Promise<string | undefined>;
};

/**
 * The token provider, the authenticated request and the grant's description,
 * for an account discovered under a product's root. Nothing here touches the
 * network until a call is made.
 */
export const buildGrant = (spec: GrantSpec, service: string): { readonly grant: Grant; readonly request: Request } => {
  const tokens = makeTokenProvider(() => loadCredentials(spec.credentials), fileTokenStore(spec.stateDir));
  const tokenInfo = makeTokenInfo(makeGetJson(tokens, { service }));
  return {
    request: makeRequest(tokens, { service }),
    grant: {
      account: spec.label,
      ...(spec.address ? { address: spec.address } : {}),
      credentials: spec.credentials,
      scopes: tokens.scopes,
      whoami: async () => (await tokenInfo(await tokens.get())).email,
    },
  };
};
