import { join } from "node:path";

import { envPath, stateDirOf } from "@foreverworks/mcp-kit";

import type { Paths } from "../app/ports.js";

/**
 * Where the credentials and the token cache live (docs/configuration.md).
 *
 * - app.json, read-only, a credential and so with no default: `OBLIO_CONFIG`,
 *   else `app.json` in systemd's `CREDENTIALS_DIRECTORY` (what
 *   `LoadCredential=app.json:...` gives a unit, readable by it alone). Neither
 *   set is a config failure on the first tool call, naming the variable.
 * - the state dir, writable, for the access-token cache: the kit's one default
 *   (`OBLIO_STATE_DIR`, else systemd's `STATE_DIRECTORY`, else
 *   `$XDG_STATE_HOME/mcps/oblio`).
 */
export const ENV = { config: "OBLIO_CONFIG", stateDir: "OBLIO_STATE_DIR" } as const;

export const resolvePaths = (env: NodeJS.ProcessEnv): Paths => {
  const credentials = envPath(env, "CREDENTIALS_DIRECTORY");
  return {
    config: envPath(env, ENV.config) ?? (credentials === undefined ? undefined : join(credentials, "app.json")),
    stateDir: stateDirOf(env, "oblio", "OBLIO_STATE_DIR"),
  };
};
