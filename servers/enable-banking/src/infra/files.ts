import { saveToOutbox } from "@foreverworks/mcp-kit";

import type { FilePort } from "../app/ports.js";

/**
 * A statement is someone's financial life, so an export is never
 * world-readable: 0640, written whole or not at all. Group-readable, like every
 * other file a server here hands back, so a deployment that runs the service as
 * its own user can let a reader in by group rather than by loosening this. What
 * was written is reported by its SHA-256 and size, so a reader can prove the
 * file it opens is that one, and linked in the call's result (the kit's
 * saveToOutbox).
 */
export const makeFiles = (): FilePort => ({
  writeText: (dir, name, text) => saveToOutbox(dir, name, text),
});
