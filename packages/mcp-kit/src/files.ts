import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A file written whole or not at all: to a temp file beside it, then renamed
 * over the name. A rename is atomic, so a reader (another session, the agent
 * reading an outbox) sees the old file or the new one, never half of one.
 *
 * The temp name is unique per WRITE, not per process: one service process
 * serves every session, so two concurrent writes of one name from one pid
 * would otherwise share a temp path. The mode is set on the temp file, before
 * the rename, because rename keeps it and a chmod afterwards leaves a window
 * with the wrong one. Without `mode` the file gets the process's default.
 *
 * Returns the path written.
 */
export const writeFileAtomic = async (
  dir: string,
  name: string,
  data: string | Uint8Array,
  { mode }: { readonly mode?: number } = {},
): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, mode === undefined ? {} : { mode });
    await rename(tmp, path);
  } catch (cause) {
    await rm(tmp, { force: true });
    throw cause;
  }
  return path;
};
