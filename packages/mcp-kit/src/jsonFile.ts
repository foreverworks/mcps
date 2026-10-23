import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import lockfile from "proper-lockfile";

import { writeFileAtomic } from "./files.js";

/**
 * A JSON file several processes share.
 *
 * Several processes can run one server against one state directory (one stdio
 * copy per session, a service and its command-line modes), so the files
 * holding tokens and consents are contended. Three servers had grown their own
 * version of the two rules that matter:
 *
 * 1. **Write to a temp file and rename.** A rename is atomic; a half-written
 *    tokens.json is a grant nobody can recover.
 * 2. **Set the mode on the temp file, not after the rename.** Rename preserves
 *    the mode, and a `chmod` afterwards leaves a window where a credential is
 *    world-readable.
 *
 * Both are writeFileAtomic's (files.ts), which every other file a server
 * writes goes through too.
 */

export type JsonFileOptions = {
  /** 0600 by default. These files hold credentials. */
  readonly mode?: number;
  /** Pretty-print with a trailing newline, for a file a human reads during an incident. */
  readonly pretty?: boolean;
};

export const writeJsonFile = async (path: string, value: unknown, options: JsonFileOptions = {}): Promise<void> => {
  const { mode = 0o600, pretty = true } = options;
  await writeFileAtomic(dirname(path), basename(path), pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value), { mode });
};

/** The parsed contents, or `undefined` for absent or unparseable. */
export const readJsonFile = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

export type LockOptions = {
  /**
   * How long before a held lock is treated as abandoned. A process killed
   * mid-write must not wedge every other session forever, so this is a
   * deadline, not a courtesy.
   */
  readonly staleMs?: number;
  readonly retries?: number;
  readonly minTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
};

/**
 * Serialise a read-modify-write across PROCESSES.
 *
 * The lock is taken on a sidecar file rather than on the data file, because
 * locking a file that is about to be replaced by a rename locks an inode that
 * no longer exists.
 */
export const withFileLock = async <T>(
  stateDir: string,
  name: string,
  fn: () => Promise<T>,
  { staleMs = 30_000, retries = 10, minTimeoutMs = 100, maxTimeoutMs = 2_000 }: LockOptions = {},
): Promise<T> => {
  await mkdir(stateDir, { recursive: true });
  const lock = join(stateDir, name);
  // 0600 like the file it guards: empty, but a directory listing should not say otherwise.
  await writeFile(lock, "", { flag: "a", mode: 0o600 });
  const release = await lockfile.lock(lock, {
    stale: staleMs,
    retries: { retries, minTimeout: minTimeoutMs, maxTimeout: maxTimeoutMs },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
};
