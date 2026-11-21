import { epochNow, liveFetch, makeGrantSource } from "@foreverworks/mcp-kit";

import type { Config, Deps } from "./app/ports.js";
import { notAuthorized, asAppError, fail } from "./domain/errors.js";
import type { ToolSpec } from "./domain/schema.js";
import { configFrom, stateDirFrom } from "./infra/config.js";
import { makeOAuth } from "./infra/oauth.js";
import { makeStores, GRANT_FILE } from "./infra/stores.js";
import { makeUpstream } from "./infra/upstream.js";
import { join } from "node:path";

export type Overrides = {
  readonly config?: Partial<Config>;
  readonly stateDir?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
};

/**
 * The composition root: the only module naming both a port and what implements
 * it. Nothing here touches the network; Mobbin is reached when a tool asks.
 * Async only to read the tool list the last listing left in the state directory,
 * which registration needs at once.
 */
export const buildDeps = async (env: NodeJS.ProcessEnv, overrides: Overrides = {}): Promise<Deps> => {
  const config: Config = { ...configFrom(env), ...overrides.config };
  const stateDir = overrides.stateDir ?? stateDirFrom(env);
  const fetchImpl = overrides.fetch ?? liveFetch;
  const now = overrides.now ?? epochNow;
  const stores = makeStores(stateDir);
  const oauth = makeOAuth(fetchImpl);

  const access = makeGrantSource({
    store: stores.grant,
    path: join(stateDir, GRANT_FILE),
    lockName: "grant-refresh.lock",
    nowEpoch: now,
    missing: () => fail(notAuthorized("no Mobbin account is connected to this server yet")),
    refresh: async (refreshToken) => {
      const client = await stores.client.read();
      if (client === undefined) return fail(notAuthorized("no Mobbin account is connected to this server yet"));
      return oauth.refresh(client, refreshToken);
    },
    // Only invalid_grant and invalid_client end a grant; a busy or failing Mobbin never does.
    isRevoked: (thrown) => {
      const known = asAppError(thrown);
      return known?.kind === "not_authorized" && known.revoked === true;
    },
  });

  const remembered: { tools: readonly ToolSpec[] } = { tools: (await stores.tools.read())?.tools ?? [] };
  return {
    config,
    now,
    oauth,
    stores,
    access,
    upstream: makeUpstream({ url: config.upstreamUrl, access, fetch: fetchImpl }),
    knownTools: () => remembered.tools,
    rememberTools: async (tools) => {
      remembered.tools = tools;
      await stores.tools.write({ fetchedAtEpoch: now(), tools });
    },
  };
};
