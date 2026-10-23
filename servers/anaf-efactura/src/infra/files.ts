import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { type FileSource, type InputFiles, inputFilesWith, noteHandedBack, writeFileAtomic } from "@foreverworks/mcp-kit";

import type { FilePort } from "../app/ports.js";
import { numberedName } from "../domain/archive.js";
import { isWithin } from "./paths.js";

/** What is at `path` now: its bytes, or undefined when nothing is. */
const existing = (path: string): Promise<Buffer | undefined> =>
  readFile(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });

/**
 * The file `bytes` are saved as: the name itself when it is free or already
 * holds exactly these bytes, else the first free numbered name. Never a name
 * holding something else, which the atomic rename would replace.
 */
const placeFor = async (dir: string, name: string, bytes: Buffer): Promise<{ readonly name: string; readonly present: boolean }> => {
  for (let n = 1; ; n += 1) {
    const candidate = numberedName(name, n);
    const there = await existing(join(dir, candidate));
    if (there === undefined) return { name: candidate, present: false };
    if (there.equals(bytes)) return { name: candidate, present: true };
  }
};

/**
 * Where downloaded archives and PDFs are written: whole or not at all (the
 * kit's writeFileAtomic), in a folder the use case has already confined to the
 * outbox (resolveSaveDir), after `layout` has checked the outbox is not beside
 * app.json (paths.ts). A name already holding other bytes is never replaced:
 * the file gets the next numbered name (domain/archive.ts). Either way the
 * file is linked in the call's result.
 *
 * Mode 0640: a signed invoice is the company's and a counterparty's data, so
 * never world-readable; group-readable so a deployment can let a reader in by
 * group membership rather than by loosening this.
 *
 * Files coming IN (an invoice, a seal, by path) are read by the kit's
 * input-file reader, bound to this process's roots (MCP_FILE_ROOTS).
 */
export const makeFiles = (readInput: InputFiles, layout: () => void = () => undefined): FilePort => ({
  writeFile: async (dir, name, bytes) => {
    layout();
    const place = await placeFor(dir, name, bytes);
    const path = place.present ? join(dir, place.name) : await writeFileAtomic(dir, place.name, bytes, { mode: 0o640 });
    noteHandedBack(path, bytes.length);
    return path;
  },
  readFile: (path) => readFile(path),
  readInput,
});

/**
 * The input reader, with this server's own outbox as one more place a path may
 * point: build_invoice writes an invoice there, and validate_invoice and
 * upload_invoice take it by the path it answered, without a copy into the
 * inbox. The outbox holds only what this server wrote (archives, PDFs, built
 * invoices), so reading one back hands a caller nothing it could not give
 * through the roots. The kit's reader confines each read to its root after
 * the open, so a link planted in the outbox is refused like one anywhere else.
 */
export const withOutbox = (reader: InputFiles, outbox: string): InputFiles => {
  const own = inputFilesWith([outbox]);
  const read = (source: FileSource) =>
    source.path !== undefined && isAbsolute(source.path) && isWithin(resolve(source.path), outbox) ? own(source) : reader(source);
  return Object.assign(read, {
    roots: reader.roots,
    where: `${reader.where}; or a file this server saved in its outbox, by the path it answered`,
    help: reader.help,
  });
};
