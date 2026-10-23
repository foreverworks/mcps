import { join } from "node:path";

import { envPath, stateDirOf } from "@foreverworks/mcp-kit";

import type { Paths } from "../app/ports.js";

/**
 * Every path this server touches (docs/configuration.md):
 *
 * | variable                  | what                                  | when unset                                        |
 * |---------------------------|---------------------------------------|---------------------------------------------------|
 * | ENABLE_BANKING_CONFIG     | app.json, read only                   | a config failure from every tool that needs it    |
 * | ENABLE_BANKING_KEY        | the RS256 private key PEM, read only  | app.json's `private_key` names it                 |
 * | ENABLE_BANKING_STATE_DIR  | writable: sessions.json, .bak, .lock  | the kit's default state dir                       |
 * | ENABLE_BANKING_EXPORTS_DIR| writable: CSV statements               | <state dir>/exports                               |
 *
 * The credentials have no default, so nothing can reach a grant nobody named;
 * nothing is read at startup, so a server without them still lists its tools.
 * Under systemd, app.json and the key are files in a credentials directory,
 * which renames them to their credential names: that is what
 * ENABLE_BANKING_KEY is for, since app.json's own `private_key` would name a
 * file that is not there.
 */
export const ENV = {
  config: "ENABLE_BANKING_CONFIG",
  key: "ENABLE_BANKING_KEY",
  stateDir: "ENABLE_BANKING_STATE_DIR",
  exportsDir: "ENABLE_BANKING_EXPORTS_DIR",
} as const;

export const resolvePaths = (env: NodeJS.ProcessEnv): Paths => {
  const stateDir = stateDirOf(env, "enable-banking", "ENABLE_BANKING_STATE_DIR");
  const sessions = join(stateDir, "sessions.json");
  return {
    config: envPath(env, ENV.config),
    keyOverride: envPath(env, ENV.key),
    stateDir,
    sessions,
    backup: `${sessions}.bak`,
    exportsDir: envPath(env, ENV.exportsDir) ?? join(stateDir, "exports"),
  };
};
