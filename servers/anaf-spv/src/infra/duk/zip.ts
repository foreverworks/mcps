import { inflateRawSync } from "node:zlib";

import { drift, fail } from "../../domain/errors.js";

/**
 * Just enough of ZIP to take ANAF's "soft J" archives apart: the central
 * directory, and entries stored or deflated. No dependency for one format.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Every file in the archive by its path, `D212/D212Validator.jar` -> bytes. */
export const unzip = (archive: Uint8Array, what: string): ReadonlyMap<string, Uint8Array> => {
  const view = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  let end = -1;
  for (let i = view.length - 22; i >= Math.max(0, view.length - 22 - 0xffff); i -= 1) {
    if (view.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) return fail(drift(`${what} is not a ZIP archive`));
  const count = view.readUInt16LE(end + 10);
  let at = view.readUInt32LE(end + 16);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n += 1) {
    if (view.readUInt32LE(at) !== CENTRAL) return fail(drift(`${what}: a damaged ZIP directory`));
    const method = view.readUInt16LE(at + 10);
    const compressed = view.readUInt32LE(at + 20);
    const nameLength = view.readUInt16LE(at + 28);
    const extraLength = view.readUInt16LE(at + 30);
    const commentLength = view.readUInt16LE(at + 32);
    const local = view.readUInt32LE(at + 42);
    const name = view.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (view.readUInt32LE(local) !== LOCAL) return fail(drift(`${what}: a damaged ZIP entry ${name}`));
    const start = local + 30 + view.readUInt16LE(local + 26) + view.readUInt16LE(local + 28);
    const raw = view.subarray(start, start + compressed);
    if (method === 0) files.set(name, new Uint8Array(raw));
    else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(raw)));
    else return fail(drift(`${what}: ${name} uses ZIP method ${method}`));
  }
  return files;
};
