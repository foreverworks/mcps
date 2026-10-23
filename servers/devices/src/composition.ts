import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { envPath, stateDirOf } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { makeAdb } from "./infra/adb.js";
import { loadCatalog } from "./infra/catalog.js";
import { makeDoor } from "./infra/door.js";
import { makeHosts } from "./infra/hosts.js";
import { makeSsh } from "./infra/ssh.js";
import { makeStore } from "./infra/store.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. The catalog is read once at startup, so a changed catalog
 * reaches the broker when it restarts. Nothing here can stop the start: a
 * catalog that cannot be read is every tool's config failure instead.
 */
export const buildDeps = async (env: NodeJS.ProcessEnv = process.env): Promise<Deps> => {
  const stateDir = stateDirOf(env, "devices", "DEVICES_STATE_DIR");
  const box = env["DEVICES_BOX"]?.trim() || hostname();
  const { catalog, note, problem } = await loadCatalog(envPath(env, "DEVICES_CATALOG_FILE"), box);
  return {
    catalog,
    ...(note === undefined ? {} : { catalogNote: note }),
    ...(problem === undefined ? {} : { catalogProblem: problem }),
    hosts: makeHosts(makeSsh(stateDir)),
    adb: makeAdb(),
    door: makeDoor(),
    store: makeStore(stateDir),
    now: Date.now,
    sleep: (ms) => delay(ms),
    log: (line) => console.error(line),
  };
};
