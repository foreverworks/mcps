import { crc32, inflateRawSync } from "node:zlib";

import { apiError, fail } from "../domain/errors.js";

/**
 * The files in a ZIP, read with node:zlib and nothing else.
 *
 * ANAF's archives are small and plain: two entries (the invoice XML and
 * ANAF's signature), stored or deflated, no encryption, no ZIP64. So this
 * reads the central directory and each entry it names, and checks every
 * entry's CRC: an archive that was stored or copied elsewhere can be corrupt
 * in the file itself, not just in transit, and a checksum is the difference
 * between "this is the invoice" and "these are some bytes".
 */
export type ZipEntry = { readonly name: string; readonly data: Buffer };

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

const corrupt = (why: string): never => fail(apiError(0, `the archive is not a readable ZIP: ${why}`));

/** The end-of-central-directory record: within the last 64 KiB plus its own 22 bytes (the comment's maximum). */
const endOfDirectory = (zip: Buffer): number => {
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === END_OF_DIRECTORY) return at;
  }
  return corrupt("no end-of-central-directory record");
};

export const readZip = (zip: Buffer): readonly ZipEntry[] => {
  if (zip.length < 22) return corrupt(`${zip.length} bytes`);
  const end = endOfDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== DIRECTORY_ENTRY) return corrupt(`directory entry ${i} is missing`);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x800 ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) return corrupt(`${name} is encrypted`);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_HEADER) return corrupt(`${name} has no local header`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = ((): Buffer => {
      if (method === STORED) return body;
      if (method !== DEFLATED) return corrupt(`${name} uses compression method ${method}`);
      try {
        return inflateRawSync(body);
      } catch (cause) {
        return corrupt(`${name} does not inflate: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    })();
    if (data.length !== size || crc32(data) !== crc) return corrupt(`${name} fails its checksum`);
    entries.push({ name, data });
  }
  return entries;
};
