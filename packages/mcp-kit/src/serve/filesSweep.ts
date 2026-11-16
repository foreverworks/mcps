import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";

import { isTempName } from "../files.js";
import { isInside } from "../inputFile/roots.js";
import { type FileEndpoints, sweepIntervalMs } from "./files.js";
import { type FilesLog, UPLOAD_IDLE_MS } from "./filesServe.js";

/**
 * Retention for the two file-endpoint folders (MCP_HTTP_FILES_MAX_AGE_MIN;
 * docs/configuration.md, "Files to and from another machine"). A file in the
 * inbox or the outbox is in transit: the client keeps its own copy. Where the
 * folders are tmpfs inside a container, nothing else ever clears them, and
 * their pages count against the container's memory. So, when the setting is
 * on, every regular file older than it is deleted, and so are the folders that
 * are left empty. Off unless set: with it unset nothing here runs.
 *
 * What keeps a sweep from taking what a request is using:
 *
 * - An upload is written to a temp file beside its target and renamed into
 *   place (fileStream.ts), and every write moves the temp file's mtime, so a
 *   file that is being received is always fresh. A temp file is held to the
 *   longer of the age and twice the time an upload may go quiet, so a very
 *   short age cannot reach one that is only slow.
 * - A folder is removed only when the sweep itself has just emptied it or it
 *   has not changed for the age: a folder an upload has just made for itself
 *   is left alone.
 * - Only regular files are deleted, found by `lstat` and never through a
 *   link; a folder is entered only when its real path is its own, so a link
 *   swapped in for one cannot lead a sweep out of the roots. Links, sockets and
 *   anything else are left where they are, and the roots themselves are never
 *   removed, even where one lies inside the other.
 * - A file that vanishes during a sweep is no failure. Any other error is
 *   counted and the sweep goes on with the rest.
 */

/** What one sweep did. `code` is the system's code of the first error, when `failed` is more than 0. */
export type SweepResult = { readonly files: number; readonly folders: number; readonly failed: number; readonly code?: string };

export type SweepOptions = {
  /** Files last written longer ago than this are deleted. */
  readonly maxAgeMs: number;
  /** The clock, in milliseconds since the epoch; `Date.now` unless a test brings its own. */
  readonly now?: () => number;
};

/** A temp file of an upload is kept at least this long: well past the longest an upload may go without a byte. */
const TEMP_GRACE_MS = 2 * UPLOAD_IDLE_MS;

const codeOf = (cause: unknown): string => (cause as NodeJS.ErrnoException).code ?? "error";
const vanished = (cause: unknown): boolean => codeOf(cause) === "ENOENT";

type Tally = { files: number; folders: number; failed: number; code: string | undefined };

type Rules = { readonly now: () => number; readonly maxAgeMs: number; readonly roots: ReadonlySet<string>; readonly tally: Tally };

const failed = (tally: Tally, cause: unknown): void => {
  tally.failed += 1;
  tally.code ??= codeOf(cause);
};

/**
 * Sweeps the folder `dir` (a real path) and what is below it, and says whether
 * `dir` is gone afterwards. Never throws.
 */
const sweepFolder = async (dir: string, rules: Rules): Promise<boolean> => {
  const { now, maxAgeMs, roots, tally } = rules;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if (vanished(cause)) return true;
    failed(tally, cause);
    return false;
  }
  const before = tally.files + tally.folders;
  let kept = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Its real path must be itself: a folder swapped for a link since the listing is not one to enter.
      const real = await realpath(path).catch(() => undefined);
      if (real === undefined) continue;
      if (real !== path || !(await sweepFolder(path, rules))) kept += 1;
    } else if (entry.isFile()) {
      if (!(await sweepFile(path, entry.name, rules))) kept += 1;
    } else {
      kept += 1;
    }
  }
  if (kept > 0 || roots.has(dir)) return false;
  if (tally.files + tally.folders === before) {
    // Nothing of ours made it empty: it goes only if it has sat unchanged for the age.
    const info = await lstat(dir).catch(() => undefined);
    if (info === undefined || now() - info.mtimeMs <= maxAgeMs) return false;
  }
  try {
    await rmdir(dir);
    tally.folders += 1;
    return true;
  } catch (cause) {
    // Something was put in it since the listing, or another process took it first: neither is a failure.
    if (vanished(cause)) return true;
    if (codeOf(cause) !== "ENOTEMPTY" && codeOf(cause) !== "EEXIST") failed(tally, cause);
    return false;
  }
};

/** Deletes the file at `path` if it is a regular file last written longer ago than its limit; says whether it is gone. Never throws. */
const sweepFile = async (path: string, name: string, { now, maxAgeMs, tally }: Rules): Promise<boolean> => {
  let info: Stats;
  try {
    info = await lstat(path);
  } catch (cause) {
    if (vanished(cause)) return true;
    failed(tally, cause);
    return false;
  }
  // A temp file is a file being written; it gets the longer limit. Anything but a regular file (a link put there since the listing) stays.
  const limit = isTempName(name) ? Math.max(maxAgeMs, TEMP_GRACE_MS) : maxAgeMs;
  if (!info.isFile() || now() - info.mtimeMs <= limit) return false;
  try {
    await unlink(path);
    tally.files += 1;
    return true;
  } catch (cause) {
    if (vanished(cause)) return true;
    failed(tally, cause);
    return false;
  }
};

/**
 * One sweep of the folders `roots` (absolute paths; one that does not exist
 * yet has nothing to sweep). Never throws.
 */
export const sweepFolders = async (roots: readonly string[], { maxAgeMs, now = Date.now }: SweepOptions): Promise<SweepResult> => {
  const tally: Tally = { files: 0, folders: 0, failed: 0, code: undefined };
  try {
    const real = new Set<string>();
    for (const root of roots) {
      const found = await realpath(root).catch((cause: unknown) => (vanished(cause) ? undefined : failed(tally, cause)));
      if (found !== undefined) real.add(found);
    }
    const rules: Rules = { now, maxAgeMs, roots: real, tally };
    // A root inside another is swept as part of it.
    for (const root of real) {
      if ([...real].some((other) => other !== root && isInside(other, root))) continue;
      await sweepFolder(root, rules);
    }
  } catch (cause) {
    failed(tally, cause);
  }
  return { files: tally.files, folders: tally.folders, failed: tally.failed, ...(tally.code === undefined ? {} : { code: tally.code }) };
};

/** A sweep that goes on while the server runs. */
export type Sweeper = {
  /** Resolves when the sweep under way, if any, is over. */
  readonly idle: () => Promise<void>;
  /** Stops the sweeps and waits for the one under way. */
  readonly stop: () => Promise<void>;
};

export type SweepingContext = {
  /** The server's name, for the log line. */
  readonly service: string;
  readonly log: FilesLog;
  readonly now?: () => number;
};

/**
 * Starts the retention for the endpoints' folders: one sweep now, then one
 * every `sweepIntervalMs`, on a timer that never keeps the process alive.
 * Undefined, and nothing started, when MCP_HTTP_FILES_MAX_AGE_MIN is unset.
 * A sweep that is still running when the next is due makes it skip, and one
 * that fails writes one line (the system's code, never a path) and the next
 * goes on as if nothing happened.
 */
export const startSweeping = (files: FileEndpoints, { service, log, now }: SweepingContext): Sweeper | undefined => {
  if (files.maxAgeMin === undefined) return undefined;
  const roots = [files.inbox, files.outbox].filter((folder): folder is string => folder !== undefined);
  const maxAgeMs = files.maxAgeMin * 60_000;
  let running: Promise<void> | undefined;

  const sweep = (): Promise<void> => {
    running ??= (async () => {
      try {
        const done = await sweepFolders(roots, { maxAgeMs, ...(now === undefined ? {} : { now }) });
        if (done.files > 0 || done.folders > 0 || done.failed > 0) {
          log(`files ${JSON.stringify({ svc: service, direction: "sweep", outcome: done.failed > 0 ? "failed" : "ok", removed: done.files, folders: done.folders, ...(done.failed > 0 ? { failed: done.failed, code: done.code } : {}) })}`);
        }
      } catch {
        // The log itself failed: a sweep is not worth the process.
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  const timer = setInterval(() => void sweep(), sweepIntervalMs(files.maxAgeMin));
  timer.unref();
  void sweep();
  return {
    idle: async () => void (await running),
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
};
