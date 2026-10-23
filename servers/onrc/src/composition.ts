import { randomBytes } from "node:crypto";

import { bearer, epochNow } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { claimsOf } from "./domain/claims.js";
import { type AppConfig, configFrom } from "./infra/config.js";
import { makeGrant } from "./infra/grant.js";
import { makePortalHttp, type PortalHttpOptions } from "./infra/http.js";
import { startKeepalive } from "./infra/keepalive.js";
import { makeLogin } from "./infra/login.js";
import { makeKeycloakClient } from "./infra/oauthClient.js";
import { makePortalApi } from "./infra/portalApi.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Built once per process; under a service that one process
 * serves every session, so the session cache and the keepalive are shared.
 * Nothing here touches the network: the first call that needs the session
 * reads it, and a missing one is that call's `needs_login`, so the server
 * starts and lists its tools without one.
 */
export type Built = { readonly deps: Deps; readonly config: AppConfig; readonly stop: () => void };

export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: PortalHttpOptions = {}): Built => {
  const config = configFrom(env);
  const now = epochNow;
  const client = makeKeycloakClient({ issuer: config.issuer, clientId: config.clientId, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const { session, access } = makeGrant({ stateDir: config.stateDir, client, now });
  const portal = makePortalApi(makePortalHttp(bearer(access), options), config.portal);
  const login = makeLogin({ config, client, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const stop = config.keepaliveMin > 0 ? startKeepalive(session, config.keepaliveMin, now) : () => undefined;
  return {
    config,
    stop,
    deps: { portal, session, login, claimsOf, now, random: (n) => randomBytes(n), loginScript: config.loginScript },
  };
};
