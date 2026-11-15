import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import { type Issues, issuesText } from "./issues.js";
import { readJsonFile, withFileLock, writeJsonFile } from "./jsonFile.js";

/**
 * One record a server keeps in a JSON file of its state dir (a session, a
 * begun sign-in, a grant): checked against its shape on disk at every read,
 * mapped to the shape the server works with, and written whole, atomically
 * and at 0600 (writeJsonFile). The shape on disk and its field names stay the
 * server's: a file already on someone's disk must keep reading after an
 * upgrade.
 *
 * A file that is not there or is not JSON reads as absent. One that is JSON
 * but not the shape reads as absent too, unless the server gives `corrupt`:
 * a session someone edited is then the server's own failure, named with what
 * is wrong, rather than a sign-in that silently replaces it.
 */
export type StoredFile<T> = {
  readonly read: () => Promise<T | undefined>;
  readonly write: (value: T) => Promise<void>;
  readonly clear: () => Promise<void>;
};

/** Anything with zod's safeParse, so the kit does not pin a schema library for its callers. */
export type DiskSchema<D> = { readonly safeParse: (value: unknown) => { success: true; data: D } | { success: false; error: Issues } };

export type StoredFileOptions<T, D> = {
  readonly schema: DiskSchema<D>;
  readonly fromDisk: (onDisk: D) => T;
  readonly toDisk: (value: T) => D;
  /** The server's failure for a file that is JSON but not the shape; `issues` names what is wrong, never a value. */
  readonly corrupt?: (issues: string) => never;
  /**
   * A sidecar lock in the file's directory that writes and clears take, for
   * a file two processes may replace at once (two sessions beginning a
   * sign-in). Reads take no lock: a rename is atomic.
   */
  readonly lock?: string;
};

export const storedFile = <T, D>(path: string, { schema, fromDisk, toDisk, corrupt, lock }: StoredFileOptions<T, D>): StoredFile<T> => {
  const locked = <R>(fn: () => Promise<R>): Promise<R> => (lock === undefined ? fn() : withFileLock(dirname(path), lock, fn));
  return {
    read: async () => {
      const raw = await readJsonFile<unknown>(path);
      if (raw === undefined) return undefined;
      const parsed = schema.safeParse(raw);
      if (parsed.success) return fromDisk(parsed.data);
      return corrupt === undefined ? undefined : corrupt(issuesText(parsed.error));
    },
    write: (value) => locked(() => writeJsonFile(path, toDisk(value))),
    clear: () => locked(() => rm(path, { force: true })),
  };
};
