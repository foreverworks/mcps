import { envPath, stateDirOf, timeZoneOf } from "@foreverworks/mcp-kit";
import { join } from "node:path";

import type { Paths } from "../app/ports.js";

/** `bolt-food` -> `BOLT_FOOD`: the prefix of every variable a server reads. */
export const envPrefix = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/**
 * Where a receipts server keeps what it keeps, from the environment alone. For
 * a server named `bolt-food`:
 *
 *   BOLT_FOOD_CREDS        credentials.json; no default, so an unset one is
 *                          the tools' config failure naming it
 *   BOLT_FOOD_STATE_DIR    stored order details, under orders/; the kit's one
 *                          default for state when unset (stateDirOf)
 *   BOLT_FOOD_EXPORTS_DIR  where export_items writes; default <state>/exports
 *                          (a deployment whose service runs under its own user
 *                          points it at a folder the user can read)
 */
export const resolvePaths = (name: string, env: NodeJS.ProcessEnv = process.env): Paths => {
  const prefix = envPrefix(name);
  const credentials = `${prefix}_CREDS`;
  const stateDir = stateDirOf(env, name, `${prefix}_STATE_DIR`);
  return {
    credentials: { variable: credentials, path: envPath(env, credentials) },
    stateDir,
    ordersDir: join(stateDir, "orders"),
    exportsDir: envPath(env, `${prefix}_EXPORTS_DIR`) ?? join(stateDir, "exports"),
  };
};

/**
 * The zone a receipts server reads local dates in: `<PREFIX>_TIME_ZONE`, else
 * the process's (the kit's timeZoneOf). Set it to the zone the bank books in,
 * or every order near midnight lands on the wrong day. A name that is not an
 * IANA zone stops the server at start.
 */
export const resolveTimeZone = (name: string, env: NodeJS.ProcessEnv = process.env): string =>
  timeZoneOf(env, `${envPrefix(name)}_TIME_ZONE`);
