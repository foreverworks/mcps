import { join } from "node:path";

import { envPath, saveToOutbox, stateDirOf } from "@foreverworks/mcp-kit";

import type { OutboxPort } from "../app/ports.js";

/**
 * Where `ask_batch` with `save` writes: TYPESAFE_OUTBOX_DIR, else `outbox/`
 * under the server's state folder (TYPESAFE_STATE_DIR, the kit's default when
 * unset). Files are written whole and group-readable (0640), so a deployment
 * whose service runs as its own user can share the folder with the user's
 * group. What was written is reported by path, sha256 and size, and linked in
 * the call's result (the kit's saveToOutbox).
 */
export const makeOutbox = (env: NodeJS.ProcessEnv): OutboxPort => {
  const dir = envPath(env, "TYPESAFE_OUTBOX_DIR") ?? join(stateDirOf(env, "typesafe", "TYPESAFE_STATE_DIR"), "outbox");
  return {
    save: (name, text) => saveToOutbox(dir, name, text),
  };
};
