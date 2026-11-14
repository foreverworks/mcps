import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Files moved as streams, never held whole in memory: the half of a file
 * transfer that the file endpoints of a server (serve/filesServe.ts) and a
 * relay in front of one (packages/mcp-relay) share.
 */

/** Hex SHA-256 of the first `size` bytes of an open file, read once from the start. The caller keeps the handle. */
export const sha256OfHandle = async (handle: FileHandle, size: number): Promise<string> => {
  const hash = createHash("sha256");
  if (size > 0) for await (const chunk of handle.createReadStream({ start: 0, end: size - 1, autoClose: false })) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

export type StoreOptions = {
  /** The file's mode, before the process's umask (as `saveToOutbox`). */
  readonly mode?: number;
  /** More bytes than this and nothing is stored. */
  readonly maxBytes: number;
  /** Hex SHA-256 the bytes must have, or nothing is stored. */
  readonly sha256?: string | undefined;
};

/** What became of a stream: stored whole, or why nothing was (and then nothing is left behind). */
export type Stored =
  | { readonly ok: true; readonly size: number; readonly sha256: string }
  | { readonly ok: false; readonly reason: "too_large" }
  | { readonly ok: false; readonly reason: "checksum_mismatch"; readonly size: number; readonly sha256: string }
  /** The source failed or hung up before its end, or the disk refused the bytes. */
  | { readonly ok: false; readonly reason: "interrupted" };

const writeAll = async (handle: FileHandle, chunk: Uint8Array): Promise<void> => {
  for (let written = 0; written < chunk.length; ) {
    written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten;
  }
};

/**
 * A stream written to `target` whole or not at all: to a temp file in its
 * folder (unique per write, created exclusively), then renamed over the name, so a
 * reader sees the old file or the new one and never half of one
 * (`writeFileAtomic` does the same for bytes already in memory). The folder
 * of `target` must exist.
 *
 * The source is read to its end only if it stays within `maxBytes`; it is not
 * closed or destroyed here, so a caller can still answer on the connection
 * that carried it. The temp file is removed on every outcome but success.
 */
export const storeStream = async (source: AsyncIterable<Uint8Array>, target: string, { mode = 0o640, maxBytes, sha256 }: StoreOptions): Promise<Stored> => {
  // A short name of its own, so that a target whose name nearly fills a file system's limit still has a temp file.
  const tmp = join(dirname(target), `.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(tmp, "wx", mode);
  const hash = createHash("sha256");
  let size = 0;
  let renamed = false;
  try {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > maxBytes) return { ok: false, reason: "too_large" };
      hash.update(chunk);
      await writeAll(handle, chunk);
    }
    const actual = hash.digest("hex");
    if (sha256 !== undefined && sha256 !== actual) return { ok: false, reason: "checksum_mismatch", size, sha256: actual };
    await handle.close();
    await rename(tmp, target);
    renamed = true;
    return { ok: true, size, sha256: actual };
  } catch {
    return { ok: false, reason: "interrupted" };
  } finally {
    await handle.close().catch(() => undefined);
    if (!renamed) await rm(tmp, { force: true });
  }
};
