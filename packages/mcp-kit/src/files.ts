import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * The end of the name a file is written under before it is renamed into place
 * (`writeFileAtomic`, `storeStream`): the process, then a unique id, so that
 * two writes of one name never share a path.
 */
export const tempSuffix = (): string => `.${process.pid}.${randomUUID()}.tmp`;

/** Whether a name is a temp file of an atomic write that has not been renamed yet (`tempSuffix`). */
export const isTempName = (name: string): boolean => /\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(name);

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
export const writeFileAtomic = async (dir: string, name: string, data: string | Uint8Array, options: { readonly mode?: number } = {}): Promise<string> =>
  (await writeFileAtomicWithStats(dir, name, data, options)).path;

/**
 * `writeFileAtomic`, also answering what the file written is: its stats, read
 * from the open file after the rename, so they are this write's file whatever
 * has been put at the path since (the outbox writer records them for a client
 * held to a ceiling: serve/ownFiles.ts).
 */
export const writeFileAtomicWithStats = async (
  dir: string,
  name: string,
  data: string | Uint8Array,
  { mode }: { readonly mode?: number } = {},
): Promise<{ readonly path: string; readonly stats: BigIntStats }> => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  const tmp = `${path}${tempSuffix()}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(tmp, "w", mode);
    await handle.writeFile(data);
    await rename(tmp, path);
    return { path, stats: await handle.stat({ bigint: true }) };
  } catch (cause) {
    await rm(tmp, { force: true });
    throw cause;
  } finally {
    await handle?.close();
  }
};
