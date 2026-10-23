import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { envPath, stateDirOf } from "@foreverworks/mcp-kit";

import type { Paths } from "../app/ports.js";

/**
 * Where configuration and state live (docs/configuration.md):
 *
 *   ANAF_CONFIG         app.json, READ-ONLY; a credential, so no default
 *   ANAF_STATE_DIR      the writable state dir: tokens.json, its lock, a begun
 *                       authorization; the kit's default when unset
 *   ANAF_DOWNLOADS_DIR  the outbox downloaded archives and PDFs land in;
 *                       defaults to <state dir>/invoices
 *
 * Nothing is read or refused here, so the server starts with none of them set
 * and lists its tools; the tools that need app.json answer a config failure
 * naming the variable. tokens.json is always <state dir>/tokens.json.
 *
 * Nothing may be written beside app.json, so a state dir or an outbox inside
 * its directory is a layout problem: that directory is a credential store the
 * service should not write to, and a token file written there is one a
 * redeploy can overwrite with a stale copy. It is reported by every tool that
 * reads app.json or writes a file (composition.ts), not by a refusal to start.
 */
export const ENV = {
  config: "ANAF_CONFIG",
  stateDir: "ANAF_STATE_DIR",
  downloads: "ANAF_DOWNLOADS_DIR",
} as const;

/** Whether `path` is `dir` or anything under it. */
export const isWithin = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

const layoutProblem = (config: string | undefined, stateDir: string, downloadsDir: string): string | undefined => {
  if (config === undefined) return undefined;
  const configDir = dirname(config);
  if (isWithin(stateDir, configDir)) return `the state dir ${stateDir} is inside app.json's directory ${configDir}; nothing may be written there`;
  if (isWithin(downloadsDir, configDir))
    return `${ENV.downloads} ${downloadsDir} is inside app.json's directory ${configDir}; nothing may be written there`;
  return undefined;
};

export const resolvePaths = (env: NodeJS.ProcessEnv): Paths => {
  const config = envPath(env, ENV.config);
  const stateDir = stateDirOf(env, "anaf-efactura", "ANAF_STATE_DIR");
  const downloadsDir = envPath(env, ENV.downloads) ?? join(stateDir, "invoices");
  const problem = layoutProblem(config, stateDir, downloadsDir);
  return { config, tokens: join(stateDir, "tokens.json"), stateDir, downloadsDir, ...(problem === undefined ? {} : { layoutProblem: problem }) };
};
