import { join } from "node:path";

import { envPath, saveToOutbox, stateDirOf } from "@foreverworks/mcp-kit";

import type { OutboxPort } from "../app/ports.js";

/**
 * Where a crash log is written: APP_STORES_OUTBOX_DIR, else `outbox/` under the
 * server's state folder (APP_STORES_STATE_DIR, the kit's default when unset).
 * Written whole, reported by path, SHA-256 and size, and linked in the call's
 * result (the kit's saveToOutbox).
 */
export const makeOutbox = (env: NodeJS.ProcessEnv): OutboxPort => {
  const dir = envPath(env, "APP_STORES_OUTBOX_DIR") ?? join(stateDirOf(env, "app-stores", "APP_STORES_STATE_DIR"), "outbox");
  return { save: (name, bytes) => saveToOutbox(dir, name, bytes) };
};
