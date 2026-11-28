import { AsyncLocalStorage } from "node:async_hooks";
import { type BigIntStats, lstatSync } from "node:fs";

import { writeFileAtomicWithStats } from "./files.js";
import { sha256Of } from "./inputFile/bytes.js";
import { type EmbeddedFile, embeddedFile, type ResourceLink, resourceLinkTo } from "./outbox.js";

/**
 * The files one tool call hands back, so its result can link each one.
 *
 * A server's outbox writer notes every file it saves (or finds there already,
 * byte for byte) with `noteHandedBack`; the envelope runs each call inside
 * `collectHandedBack` and adds a `resource_link` per file noted to a
 * successful result. Noting where the file is written, not recognising a
 * file-like shape in a result, is what keeps an input file's report (a path,
 * a size and a SHA-256 too) from being linked as if it were handed back.
 *
 * Outside a call (a shell mode, a test of a writer alone) there is nothing to
 * collect into, and a note is a no-op.
 *
 * The guard watches the same notes for the whole call (`watchHandedBack`),
 * envelope or not, since it alone knows which client made the call: over HTTP
 * that is how a client held to a ceiling may fetch the files its own calls
 * handed back, and nothing else (serve/ownFiles.ts). What it is told is which
 * file was written, not only where: the stats of the file itself, so a file
 * another call puts at the same path before this one ends is not taken for it.
 */
const calls = new AsyncLocalStorage<Map<string, ResourceLink | EmbeddedFile>>();

/** A file a call handed back, as the guard sees it: the size noted, and the file's stats as it was written (undefined when it could not be read). */
export type HandedBack = { readonly size: number; readonly stats: BigIntStats | undefined };

/** The guard's view of one call: every file handed back inside it. */
const watched = new AsyncLocalStorage<Map<string, HandedBack>>();

/** The file at `path` now, not through a link; undefined when there is none. */
const statNow = (path: string): BigIntStats | undefined => {
  try {
    return lstatSync(path, { bigint: true });
  } catch {
    return undefined;
  }
};

/**
 * A file this call saved to its outbox, at an absolute path, of `size` bytes.
 * One link per path, the last size noted. Call it right after the write: when
 * the guard is watching and `stats` (the written file's, as
 * `writeFileAtomicWithStats` answers them) is not given, the file at the path
 * is read now, with nothing awaited in between.
 */
export const noteHandedBack = (path: string, size: number, stats?: BigIntStats): void => {
  calls.getStore()?.set(path, resourceLinkTo(path, size));
  const watching = watched.getStore();
  if (watching !== undefined) watching.set(path, { size, stats: stats ?? statNow(path) });
};

/**
 * A file this call hands back inside its result, for a server with no outbox
 * its callers can read (one hosted for anyone, with nothing on disk): the
 * result carries it as embedded content (`embeddedFile`) after the JSON. One
 * per name, the last bytes noted. Outside a call this is a no-op.
 */
export const handInline = (name: string, data: string | Uint8Array): void => {
  calls.getStore()?.set(`inline:${name}`, embeddedFile(name, typeof data === "string" ? Buffer.from(data, "utf8") : data));
};

/** Runs one call, noting in `into` every file it hands back, whichever envelope links them. */
export const watchHandedBack = <T>(into: Map<string, HandedBack>, run: () => Promise<T>): Promise<T> => watched.run(into, run);

/** Runs one call, and answers what it returned with the links to the files it handed back, in the order first noted. */
export const collectHandedBack = async <T>(run: () => Promise<T>): Promise<{ readonly value: T; readonly links: readonly (ResourceLink | EmbeddedFile)[] }> => {
  const noted = new Map<string, ResourceLink | EmbeddedFile>();
  const value = await calls.run(noted, run);
  return { value, links: [...noted.values()] };
};

/** What a saved file is reported as: where it is, and the SHA-256 and size that prove a copy of it is the same file. */
export type SavedFile = { readonly path: string; readonly sha256: string; readonly size: number };

/**
 * A file saved to an outbox folder: written whole or not at all, mode 0640 by
 * default (never world-readable; group-readable, so a deployment can let its
 * reader in by group), reported by path, SHA-256 and size, and noted so the
 * call's result links it.
 */
export const saveToOutbox = async (dir: string, name: string, data: string | Uint8Array, { mode = 0o640 }: { readonly mode?: number } = {}): Promise<SavedFile> => {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const { path, stats } = await writeFileAtomicWithStats(dir, name, bytes, { mode });
  noteHandedBack(path, bytes.length, stats);
  return { path, sha256: sha256Of(bytes), size: bytes.length };
};
