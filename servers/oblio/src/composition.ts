import { once } from "@foreverworks/mcp-kit";

import { makeNomenclatureCache, NOMENCLATURE_TTL_MS } from "./app/nomenclatureCache.js";
import type { AppIdentity, Deps } from "./app/ports.js";
import { makeOblioTokens } from "./infra/auth.js";
import { type AppConfig, loadConfig } from "./infra/config.js";
import { makeOblioHttp } from "./infra/http.js";
import { makeOblioApi } from "./infra/oblioApi.js";
import { resolvePaths } from "./infra/paths.js";

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching a line of production
 * code.
 *
 * Built once per process. Served over HTTP, that one process serves every
 * client, so the token, the throttles and the nomenclature cache are shared
 * by all of them. Nothing here touches the network or a file: app.json is read
 * on the first call that needs it, and a missing one is that call's failure.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => {
  const paths = resolvePaths(env);
  const config: () => Promise<AppConfig> = once(() => loadConfig(paths.config));

  const http = makeOblioHttp(makeOblioTokens(config, paths.stateDir));
  const oblio = makeOblioApi(http, async () => (await config()).apiBase);

  const identity = async (): Promise<AppIdentity> => {
    const c = await config();
    return { accountId: c.clientId, companyCif: c.companyCif };
  };

  return {
    oblio,
    paths,
    identity,
    cache: makeNomenclatureCache(oblio, NOMENCLATURE_TTL_MS, Date.now),
    now: Date.now,
  };
};
