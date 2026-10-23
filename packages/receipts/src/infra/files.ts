import { saveToOutbox } from "@foreverworks/mcp-kit";

import type { FilePort } from "../app/ports.js";

/**
 * Exports hold what someone bought, so they are never world-readable: 0640,
 * written whole or not at all. Group-readable, like every other file a server
 * here hands back, so a deployment that runs the service as its own user can
 * let the reader in by group membership (an outbox directory owned by the
 * service with the reader's group) rather than by loosening this. The
 * directory takes the process's umask, as the kit's writer makes it. What was
 * written is reported by its SHA-256 and size, so a reader can prove the file
 * it opens is that one, and linked in the call's result (the kit's
 * saveToOutbox).
 */
export const makeFiles = (): FilePort => ({
  writeText: (dir, name, text) => saveToOutbox(dir, name, text),
});
