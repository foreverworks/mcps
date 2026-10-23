import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/** `name`, then `stem (2).ext`, `stem (3).ext`, ...: the names a file may take beside others. */
export const candidateNames = function* (name: string): Generator<string> {
  yield name;
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 2; ; n++) yield `${stem} (${n})${ext}`;
};

const MAX_TRIES = 1000;

/**
 * A file saved whole, beside whatever is already there and never over it.
 *
 * Written to a temp file first and then hard-linked to its name, which fails
 * when the name is taken: so a reader sees the whole file or none, and two
 * different files that want one name (two attachments called invoice.pdf in
 * one message) both survive, the second as `invoice (2).pdf`. A name already
 * holding these very bytes is the file itself, saved before, and is returned
 * as it is: saving the same attachment twice makes one file.
 *
 * Returns the path the bytes are at.
 */
export const saveNew = async (dir: string, name: string, bytes: Uint8Array): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, bytes);
  try {
    let tries = 0;
    for (const candidate of candidateNames(name)) {
      if (++tries > MAX_TRIES) break;
      const path = join(dir, candidate);
      const taken = await link(tmp, path).then(
        () => false,
        (cause: NodeJS.ErrnoException) => {
          if (cause.code === "EEXIST") return true;
          throw cause;
        },
      );
      if (!taken) return path;
      const existing = await readFile(path).catch(() => undefined);
      if (existing !== undefined && Buffer.compare(existing, bytes) === 0) return path;
    }
    throw new Error(`${MAX_TRIES} files named like ${name} already in ${dir}`);
  } finally {
    await rm(tmp, { force: true });
  }
};
