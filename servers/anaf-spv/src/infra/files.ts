import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { noteHandedBack, writeFileAtomic } from "@foreverworks/mcp-kit";

import type { FilePort } from "../app/ports.js";

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** What is at `path` now: its bytes, or undefined when nothing is. */
const existing = (path: string): Promise<Buffer | undefined> =>
  readFile(path).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });

/** `name` for n = 1, else `stem-n.ext`. */
export const numberedName = (name: string, n: number): string => {
  if (n === 1) return name;
  const ext = extname(name);
  return `${name.slice(0, name.length - ext.length)}-${n}${ext}`;
};

/**
 * The outbox downloads are written to: whole or not at all (the kit's
 * writeFileAtomic), mode 0640 (a tax document is personal data: never
 * world-readable, group-readable so a deployment can let a reader in by
 * group). A name already holding these bytes is reported as already there; a
 * name holding other bytes is never replaced, the file gets the next numbered
 * name. Either way the file is linked in the call's result.
 */
export const makeFiles = (root: string): FilePort => ({
  root,
  save: async (dir, name, bytes) => {
    for (let n = 1; ; n += 1) {
      const candidate = numberedName(name, n);
      const there = await existing(join(dir, candidate));
      if (there?.equals(bytes)) {
        noteHandedBack(join(dir, candidate), bytes.length);
        return { path: join(dir, candidate), present: true };
      }
      if (there === undefined) {
        const path = await writeFileAtomic(dir, candidate, bytes, { mode: 0o640 });
        noteHandedBack(path, bytes.length);
        return { path, present: false };
      }
    }
  },
});
