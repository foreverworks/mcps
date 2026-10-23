import { createHash, randomUUID } from "node:crypto";
import { createReadStream, openAsBlob } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import { noteHandedBack, writeFileAtomic } from "@foreverworks/mcp-kit";

import type { CalibrationStore, Outbox, SavedFile, Scratch } from "../app/ports.js";
import { type Calibration, calibrationText, parseCalibration } from "../domain/correction/calibration.js";
import { fail, inputError } from "../domain/errors.js";

/** The calibration file in the server's state directory; the one it replaced is kept beside it. */
export const makeCalibrationStore = (stateDir: string): CalibrationStore => {
  const path = join(stateDir, "calibration.json");
  return {
    path,
    load: async (): Promise<Calibration | undefined> => {
      const text = await readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => (cause.code === "ENOENT" ? undefined : Promise.reject(cause)));
      if (text === undefined) return undefined;
      const parsed = parseCalibration(text);
      return parsed.ok ? parsed.calibration : fail({ kind: "calibration", message: `${path} is not a usable calibration: ${parsed.problems.join("; ")}` });
    },
    save: async (calibration) => {
      const previous = await readFile(path).catch(() => undefined);
      if (previous !== undefined) await writeFileAtomic(stateDir, "calibration.previous.json", previous, { mode: 0o600 });
      await writeFileAtomic(stateDir, "calibration.json", calibrationText(calibration), { mode: 0o600 });
    },
  };
};

const sha256OfFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

/**
 * The outbox: files land whole (a temp name, then a rename) and readable by
 * the outbox's group, 0640, since that is how a service hands its caller a
 * file it may read and nobody else may. Each is linked in the call's result.
 */
export const makeOutbox = (dir: string): Outbox => ({
  dir,
  save: async (name, content): Promise<SavedFile> => {
    const relative = normalize(name);
    if (relative.startsWith("..") || relative.startsWith("/")) return fail(inputError(`${name} is not a name inside the outbox`));
    const path = join(dir, relative);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const data = content instanceof Blob ? Readable.fromWeb(content.stream() as import("node:stream/web").ReadableStream<Uint8Array>) : content;
      await writeFile(tmp, data, { mode: 0o640 });
      await rename(tmp, path);
    } catch (cause) {
      await rm(tmp, { force: true });
      throw cause;
    }
    const size = content instanceof Blob ? content.size : content.byteLength;
    noteHandedBack(path, size);
    return { path, sha256: await sha256OfFile(path), size };
  },
  read: async (given) => {
    const root = await realpath(dir).catch(() => resolve(dir));
    const wanted = isAbsolute(given) ? resolve(given) : resolve(dir, given);
    const outside = () => fail(inputError(`${given} is not a file this server saved in its outbox (${dir})`));
    const stat = await lstat(wanted).catch(() => undefined);
    if (stat === undefined || !stat.isFile()) return outside();
    const real = await realpath(wanted);
    if (!real.startsWith(`${root}${sep}`)) return outside();
    return { bytes: new Uint8Array(await readFile(real)), path: real };
  },
});

/** A private folder for one call's working files (rendered pages, the document as sent), removed when the call ends. */
export const makeScratch = (root: string = tmpdir()) => async (): Promise<Scratch> => {
  const dir = await mkdtemp(join(root, "printer-"));
  return {
    write: async (name, data) => {
      const path = join(dir, name.replace(/[^A-Za-z0-9._-]/g, "-"));
      await writeFile(path, data, { mode: 0o600 });
      return path;
    },
    blob: (path) => openAsBlob(path),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
};
