import { join } from "node:path";

import { envPath, saveToOutbox, stateDirOf } from "@foreverworks/mcp-kit";

import type { OutboxPort } from "../app/ports.js";

/**
 * Where download_mark_documents writes: TRADEMARKS_OUTBOX_DIR, else `outbox/`
 * under the server's state folder (TRADEMARKS_STATE_DIR, the kit's default when
 * unset). Files are written whole and group-readable (0640), reported by path,
 * SHA-256 and size, and linked in the call's result (the kit's saveToOutbox).
 */
export const makeOutbox = (env: NodeJS.ProcessEnv): OutboxPort => {
  const dir = envPath(env, "TRADEMARKS_OUTBOX_DIR") ?? join(stateDirOf(env, "trademarks", "TRADEMARKS_STATE_DIR"), "outbox");
  return { save: (name, bytes) => saveToOutbox(dir, name, bytes) };
};
