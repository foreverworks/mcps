import { randomBytes } from "node:crypto";

import { bearer, epochNow, type UpstreamConnect, type UpstreamEndpoint } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { claimsOf } from "./domain/claims.js";
import { type AppConfig, configFrom } from "./infra/config.js";
import { makeCredentialSource } from "./infra/credentials.js";
import { makeGrant } from "./infra/grant.js";
import { makePortalHttp, type PortalHttpOptions } from "./infra/http.js";
import { startKeepalive } from "./infra/keepalive.js";
import { makeLogin } from "./infra/login.js";
import { makeKeycloakClient } from "./infra/oauthClient.js";
import { makeOutbox } from "./infra/outbox.js";
import { makePortalApi } from "./infra/portalApi.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Built once per process; under a service that one process
 * serves every session, so the session cache and the keepalive are shared.
 * Nothing here touches the network or reads a password: the first call that
 * needs the session makes one, and a missing way to make one is that call's
 * `needs_login`, so the server starts and lists its tools without any setting.
 */
export type Built = { readonly deps: Deps; readonly config: AppConfig; readonly stop: () => void };

export type BuildOptions = PortalHttpOptions & {
  /** How the vault is reached; tests pass an in-memory server. */
  readonly connectFor?: (endpoint: UpstreamEndpoint) => UpstreamConnect;
  readonly now?: () => number;
  readonly random?: (bytes: number) => Uint8Array;
};

export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: BuildOptions = {}): Built => {
  const { connectFor, now: clock, random: rng, ...httpOptions } = options;
  const config = configFrom(env);
  const now = clock ?? epochNow;
  const random = rng ?? ((n: number) => randomBytes(n));
  const sleep = async (ms: number): Promise<void> => {
    await (httpOptions.sleep ?? ((wait: number) => new Promise<void>((resolve) => setTimeout(resolve, wait))))(ms);
  };
  const fetchOption = httpOptions.fetch ? { fetch: httpOptions.fetch } : {};
  const client = makeKeycloakClient({ issuer: config.issuer, clientId: config.clientId, ...fetchOption });
  const credentials = makeCredentialSource(config, { now, sleep }, connectFor);
  const login = makeLogin({ config, client, ...fetchOption });
  const { session, access } = makeGrant({ stateDir: config.stateDir, client, login, credentials, now, random });
  const portal = makePortalApi(makePortalHttp(bearer(access), httpOptions), config.portal);
  const stop = config.keepaliveMin > 0 ? startKeepalive(session, config.keepaliveMin, now) : () => undefined;
  return {
    config,
    stop,
    deps: { portal, session, login, credentials, outbox: makeOutbox(config.outboxDir), claimsOf, now, random, loginScript: config.loginScript },
  };
};
