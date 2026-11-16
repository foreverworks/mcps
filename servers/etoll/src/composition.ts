import { randomBytes } from "node:crypto";

import { bearer, epochNow, type UpstreamConnect, type UpstreamEndpoint } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { claimsOf } from "./domain/claims.js";
import { type AppConfig, configFrom } from "./infra/config.js";
import { makeCredentialSource } from "./infra/credentials.js";
import { makeEtollApi } from "./infra/etollApi.js";
import { makeGrant } from "./infra/grant.js";
import { type EtollHttpOptions, makeEtollHttp } from "./infra/http.js";
import { makeLogin } from "./infra/login.js";
import { makeKeycloakClient } from "./infra/oauthClient.js";
import { makeOutbox } from "./infra/outbox.js";
import { makeStatusApi } from "./infra/statusApi.js";
import { makeStore } from "./infra/store.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Built once per process; under a service that one process
 * serves every session, so the session cache is shared. Nothing here touches
 * the network or reads a password: the first call that needs the session
 * makes one, and a missing way to make one is that call's `needs_login`, so
 * the server starts and lists its tools without any setting.
 */
export type Built = { readonly deps: Deps; readonly config: AppConfig };

export type BuildOptions = EtollHttpOptions & {
  /** How the vault is reached; tests pass an in-memory server. */
  readonly connectFor?: (endpoint: UpstreamEndpoint) => UpstreamConnect;
};

export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: BuildOptions = {}): Built => {
  const { connectFor, ...httpOptions } = options;
  const config = configFrom(env);
  const now = epochNow;
  const fetchOption = httpOptions.fetch ? { fetch: httpOptions.fetch } : {};
  const client = makeKeycloakClient({ issuer: config.issuer, clientId: config.clientId, ...fetchOption });
  const credentials = makeCredentialSource(config, connectFor);
  const { session, access } = makeGrant({ stateDir: config.stateDir, client, credentials, scopes: config.scopes, now });
  const etoll = makeEtollApi(makeEtollHttp(bearer(access), httpOptions), config.api);
  const status = makeStatusApi(makeEtollHttp(undefined, httpOptions), config.api);
  const login = makeLogin({ config, client, ...fetchOption });
  return {
    config,
    deps: {
      etoll,
      status,
      session,
      login,
      credentials,
      store: makeStore(config.stateDir, now),
      outbox: makeOutbox(config.outboxDir),
      claimsOf,
      now,
      random: (n) => randomBytes(n),
      loginScript: config.loginScript,
    },
  };
};
