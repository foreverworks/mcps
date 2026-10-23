/**
 * PWG Raster (PWG 5102.4), the lossless page format IPP Everywhere printers
 * take: a sync word, then per page a 1796-byte header and the page's lines,
 * each line compressed with a PackBits-like scheme and repeated lines
 * counted. Only 8-bit sGray pages are written here, which is what a mono
 * printer's `pwg-raster-document-type-supported` offers as `sgray_8`.
 *
 * The encoder makes the same bytes as the reference encoder this server's
 * correction was validated with, so a page can be compared byte for byte; the
 * decoder reads any 8-bit single-colour PWG back, for round trips and checks.
 */

export type GreyPage = {
  readonly width: number;
  readonly height: number;
  /** Row-major, one byte per pixel, 255 paper white. */
  readonly pixels: Uint8Array;
};

export type PageSetup = {
  readonly dpi: number;
  /** Media size in PostScript points, as the header carries it (A4 is 595 x 842). */
  readonly pageSizePt: readonly [number, number];
  /** The PWG self-describing media name, e.g. iso_a4_210x297mm. */
  readonly pageSizeName: string;
};

export const SYNC_WORD = "RaS2";
export const HEADER_BYTES = 1796;
const SGRAY = 18;

export const A4: PageSetup = { dpi: 600, pageSizePt: [595, 842], pageSizeName: "iso_a4_210x297mm" };

const writeText = (header: Buffer, offset: number, text: string): void => {
  header.write(text, offset, "ascii");
};

export const pageHeader = (page: { readonly width: number; readonly height: number }, setup: PageSetup, totalPages: number): Buffer => {
  const h = Buffer.alloc(HEADER_BYTES);
  writeText(h, 0, "PwgRaster");
  writeText(h, 128, "stationery"); // MediaType
  h.writeUInt32BE(setup.dpi, 276); // HWResolution
  h.writeUInt32BE(setup.dpi, 280);
  h.writeUInt32BE(1, 340); // NumCopies: copies are pages in the stream
  h.writeUInt32BE(setup.pageSizePt[0], 352); // PageSize
  h.writeUInt32BE(setup.pageSizePt[1], 356);
  h.writeUInt32BE(page.width, 372);
  h.writeUInt32BE(page.height, 376);
  h.writeUInt32BE(8, 384); // BitsPerColor
  h.writeUInt32BE(8, 388); // BitsPerPixel
  h.writeUInt32BE(page.width, 392); // BytesPerLine
  h.writeUInt32BE(0, 396); // ColorOrder: chunky
  h.writeUInt32BE(SGRAY, 400); // ColorSpace
  h.writeUInt32BE(1, 420); // NumColors
  h.writeUInt32BE(totalPages, 452); // TotalPageCount
  h.writeInt32BE(1, 456); // CrossFeedTransform
  h.writeInt32BE(1, 460); // FeedTransform
  h.writeUInt32BE(0x00ffffff, 480); // AlternatePrimary
  writeText(h, 1732, setup.pageSizeName);
  return h;
};

/**
 * One line: runs of 2 or more equal bytes as (count - 1, value), up to 128
 * at a time; everything else as literals, (257 - count) then the bytes, up to
 * 128 at a time, a lone literal byte written as a run of one. Written into
 * `out` (at least twice the row's length), returning how many bytes.
 */
const encodeLineInto = (row: Uint8Array, out: Uint8Array): number => {
  let o = 0;
  let literalStart = -1;
  const flush = (end: number): void => {
    if (literalStart < 0) return;
    for (let at = literalStart; at < end; at += 128) {
      const count = Math.min(128, end - at);
      out[o++] = count === 1 ? 0 : 257 - count;
      out.set(row.subarray(at, at + count), o);
      o += count;
    }
    literalStart = -1;
  };
  let start = 0;
  while (start < row.length) {
    const value = row[start] as number;
    let end = start + 1;
    while (end < row.length && row[end] === value) end += 1;
    let run = end - start;
    if (run === 1) {
      if (literalStart < 0) literalStart = start;
    } else {
      flush(start);
      while (run > 0) {
        const k = Math.min(run, 128);
        out[o++] = k - 1;
        out[o++] = value;
        run -= k;
      }
    }
    start = end;
  }
  flush(row.length);
  return o;
};

export const encodeLine = (row: Uint8Array): Buffer => {
  const out = Buffer.alloc(row.length * 2 + 2);
  return out.subarray(0, encodeLineInto(row, out));
};

const sameRow = (pixels: Uint8Array, width: number, a: number, b: number): boolean => {
  const ra = a * width;
  const rb = b * width;
  for (let x = 0; x < width; x += 1) if (pixels[ra + x] !== pixels[rb + x]) return false;
  return true;
};

/** A page's lines: each line once, preceded by how many times it repeats minus one (up to 256 lines). */
export const encodePage = (page: GreyPage): Buffer => {
  const { width, height, pixels } = page;
  const parts: Buffer[] = [];
  const scratch = Buffer.alloc(width * 2 + 3);
  let y = 0;
  while (y < height) {
    let repeat = 1;
    while (y + repeat < height && repeat < 256 && sameRow(pixels, width, y + repeat, y)) repeat += 1;
    scratch[0] = repeat - 1;
    const n = encodeLineInto(pixels.subarray(y * width, (y + 1) * width), scratch.subarray(1));
    parts.push(Buffer.from(scratch.subarray(0, n + 1)));
    y += repeat;
  }
  return Buffer.concat(parts);
};

/** A whole document: the sync word, then each page's header and lines. */
export const encodeDocument = (pages: readonly GreyPage[], setup: PageSetup): Buffer =>
  Buffer.concat([Buffer.from(SYNC_WORD, "ascii"), ...pages.flatMap((p) => [pageHeader(p, setup, pages.length), encodePage(p)])]);

export type DecodedPage = GreyPage & { readonly dpi: number; readonly totalPages: number; readonly pageSizeName: string };

/** Reads a document back; throws a RangeError naming what is wrong with a malformed one. */
export const decodeDocument = (data: Uint8Array): readonly DecodedPage[] => {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.subarray(0, 4).toString("ascii") !== SYNC_WORD) throw new RangeError("not PWG raster: no RaS2 sync word");
  const pages: DecodedPage[] = [];
  let p = 4;
  while (p < buf.length) {
    if (p + HEADER_BYTES > buf.length) throw new RangeError(`page ${pages.length + 1}: header cut short`);
    const h = buf.subarray(p, p + HEADER_BYTES);
    p += HEADER_BYTES;
    const width = h.readUInt32BE(372);
    const height = h.readUInt32BE(376);
    const bitsPerPixel = h.readUInt32BE(388);
    const bytesPerLine = h.readUInt32BE(392);
    if (bitsPerPixel !== 8 || bytesPerLine !== width) throw new RangeError(`page ${pages.length + 1}: only 8-bit single-colour pages are read here`);
    const pixels = new Uint8Array(width * height);
    let y = 0;
    while (y < height) {
      if (p >= buf.length) throw new RangeError(`page ${pages.length + 1}: data cut short at line ${y}`);
      const repeat = (buf[p++] as number) + 1;
      const line = new Uint8Array(bytesPerLine);
      let n = 0;
      while (n < bytesPerLine) {
        if (p >= buf.length) throw new RangeError(`page ${pages.length + 1}: data cut short at line ${y}`);
        const c = buf[p++] as number;
        if (c < 128) {
          const count = c + 1;
          if (n + count > bytesPerLine) throw new RangeError(`page ${pages.length + 1}: a run overflows line ${y}`);
          if (p >= buf.length) throw new RangeError(`page ${pages.length + 1}: data cut short at line ${y}`);
          line.fill(buf[p++] as number, n, n + count);
          n += count;
        } else if (c === 128) {
          line.fill(255, n);
          n = bytesPerLine;
        } else {
          const count = 257 - c;
          if (n + count > bytesPerLine) throw new RangeError(`page ${pages.length + 1}: literals overflow line ${y}`);
          if (p + count > buf.length) throw new RangeError(`page ${pages.length + 1}: data cut short at line ${y}`);
          line.set(buf.subarray(p, p + count), n);
          p += count;
          n += count;
        }
      }
      for (let r = 0; r < repeat && y < height; r += 1, y += 1) pixels.set(line, y * width);
    }
    pages.push({
      width,
      height,
      pixels,
      dpi: h.readUInt32BE(276),
      totalPages: h.readUInt32BE(452),
      pageSizeName: h.subarray(1732, 1796).toString("ascii").replace(/\0+$/, ""),
    });
  }
  return pages;
};
