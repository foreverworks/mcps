import { memoize } from "@foreverworks/mcp-kit";
import { HISTORY_TTL_MS, makeFiles, makeOrderStore, resolvePaths, resolveTimeZone } from "@foreverworks/receipts/infra";

import type { Deps } from "./app/ports.js";
import { NAME } from "./app/usecases/receipts.js";
import type { RawDetails } from "./domain/schema.js";
import { readTokenFacts } from "./domain/token.js";
import { loadCredentials } from "./infra/credentials.js";
import { makeGlovoApi } from "./infra/glovoApi.js";

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching production code.
 * Paths and the time zone come from the environment alone (GLOVO_*,
 * packages/receipts, infra/paths.ts); nothing is read until a tool needs it.
 *
 * History pages are remembered per cursor, which is an order id, so an older
 * page stays valid even after a new order shifts the first one.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => {
  const paths = resolvePaths(NAME, env);
  const credentials = () => loadCredentials(paths.credentials);
  const api = makeGlovoApi(credentials);
  return {
    glovo: { ...api, historyPage: memoize(HISTORY_TTL_MS, api.historyPage) },
    store: makeOrderStore<RawDetails>(paths.ordersDir),
    files: makeFiles(),
    paths,
    tokenFacts: async () => readTokenFacts((await credentials()).refreshToken) ?? {},
    timeZone: resolveTimeZone(NAME, env),
    now: Date.now,
  };
};
