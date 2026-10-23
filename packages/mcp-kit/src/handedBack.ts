import { AsyncLocalStorage } from "node:async_hooks";

import { writeFileAtomic } from "./files.js";
import { sha256Of } from "./inputFile/bytes.js";
import { type ResourceLink, resourceLinkTo } from "./outbox.js";

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
 */
const calls = new AsyncLocalStorage<Map<string, ResourceLink>>();

/** A file this call saved to its outbox, at an absolute path, of `size` bytes. One link per path, the last size noted. */
export const noteHandedBack = (path: string, size: number): void => {
  calls.getStore()?.set(path, resourceLinkTo(path, size));
};

/** Runs one call, and answers what it returned with the links to the files it handed back, in the order first noted. */
export const collectHandedBack = async <T>(run: () => Promise<T>): Promise<{ readonly value: T; readonly links: readonly ResourceLink[] }> => {
  const noted = new Map<string, ResourceLink>();
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
  const path = await writeFileAtomic(dir, name, bytes, { mode });
  noteHandedBack(path, bytes.length);
  return { path, sha256: sha256Of(bytes), size: bytes.length };
};
