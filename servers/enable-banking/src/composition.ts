import { epochNow, memoize, once } from "@foreverworks/mcp-kit";

import type { AppIdentity, Deps } from "./app/ports.js";
import { makeBankApi } from "./infra/bankApi.js";
import { makeFiles } from "./infra/files.js";
import { type AppConfig, loadConfig } from "./infra/config.js";
import { makeRequest } from "./infra/http.js";
import { makeSigner } from "./infra/jwt.js";
import { resolvePaths } from "./infra/paths.js";
import { makeSessionStore } from "./infra/sessionStore.js";

/**
 * The bank catalogue is the one response here that is safe to repeat: the same
 * for everyone, no account data in it, several hundred kB for every market, and
 * changed by Enable Banking's releases rather than between two calls. An hour,
 * in memory, per country ("" for every market); a failure is not remembered.
 * Nothing about an account, a session or a transaction is ever cached.
 */
export const ASPSP_TTL_MS = 3_600_000;

/**
 * The composition root: the ONLY place that names both an interface and the
 * thing implementing it. Every other module depends on ports, which is what
 * lets the tests swap the network out without touching a line of production
 * code.
 *
 * Built once per process. Over HTTP that one process serves every session, so
 * the parsed key and the bank catalogue cache are shared by all of them.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env): Deps => {
  const paths = resolvePaths(env);
  const config: () => Promise<AppConfig> = once(() => loadConfig(paths.config, paths.keyOverride));

  // The key path comes from app.json (or the env), so the signer is built
  // lazily too: a missing config must surface as one tool saying so, not as a
  // server that died before it could be asked. Built ONCE, because the signer
  // is what holds the parsed private key.
  const signer = once(async () => {
    const c = await config();
    return makeSigner(c.privateKeyPath, epochNow, async () => c.applicationId);
  });
  const sign = async (): Promise<string> => (await signer())();
  const api = makeBankApi(
    makeRequest(sign, async () => (await config()).apiBase),
    async () => (await config()).redirectUrl,
  );
  const catalogue = memoize(ASPSP_TTL_MS, (country: string) => api.listAspsps(country === "" ? undefined : country));
  const bank = { ...api, listAspsps: (country: string | undefined) => catalogue(country ?? "") };

  const identity = async (): Promise<AppIdentity> => {
    const c = await config();
    return {
      applicationId: c.applicationId,
      applicationName: c.applicationName,
      environment: c.environment,
      redirectUrl: c.redirectUrl,
      privateKeyPath: c.privateKeyPath,
    };
  };

  return { bank, sessions: makeSessionStore(paths), files: makeFiles(), paths, identity, now: epochNow };
};
