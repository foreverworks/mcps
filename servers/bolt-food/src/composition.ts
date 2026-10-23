import { memoize } from "@foreverworks/mcp-kit";
import { HISTORY_TTL_MS, makeFiles, makeOrderStore, resolvePaths, resolveTimeZone } from "@foreverworks/receipts/infra";

import type { Deps } from "./app/ports.js";
import { NAME } from "./app/usecases/receipts.js";
import type { RawDetails } from "./domain/schema.js";
import { readTokenFacts } from "./domain/token.js";
import { makeBoltApi } from "./infra/boltApi.js";
import { loadCredentials } from "./infra/credentials.js";

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching production code.
 * Paths and the time zone come from the environment alone (BOLT_FOOD_*,
 * packages/receipts, infra/paths.ts); nothing is read until a tool needs it.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => {
  const paths = resolvePaths(NAME, env);
  const credentials = () => loadCredentials(paths.credentials);
  const api = makeBoltApi(credentials);
  const history = memoize(HISTORY_TTL_MS, (_all: "all") => api.history());
  return {
    bolt: { ...api, history: () => history("all") },
    store: makeOrderStore<RawDetails>(paths.ordersDir),
    files: makeFiles(),
    paths,
    tokenFacts: async () => readTokenFacts((await credentials()).refreshToken) ?? {},
    timeZone: resolveTimeZone(NAME, env),
    now: Date.now,
  };
};
