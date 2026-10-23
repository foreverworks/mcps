import { inflateSync } from "node:zlib";

/**
 * The files embedded in a PDF (`/Type /EmbeddedFile` streams), as
 * DUKIntegrator's PDF step attaches the declaration's XML: one stream,
 * FlateDecode, its `/Length` often an indirect object (measured: a PDF it
 * makes and a filed one both carry the source XML byte for byte). Enough of
 * PDF for that and nothing more.
 */

const lengthOf = (text: string, dict: string): number | undefined => {
  const ref = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dict);
  if (ref !== null) {
    const value = new RegExp(`(?:^|[\\s>])${ref[1]}\\s+${ref[2]}\\s+obj\\s*(\\d+)\\s*endobj`).exec(text)?.[1];
    return value === undefined ? undefined : Number(value);
  }
  const direct = /\/Length\s+(\d+)/.exec(dict)?.[1];
  return direct === undefined ? undefined : Number(direct);
};

export const embeddedFiles = (pdf: Uint8Array): readonly Uint8Array[] => {
  const bytes = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  // latin1 keeps one character per byte, so a text index is a byte index.
  const text = bytes.toString("latin1");
  const found: Uint8Array[] = [];
  for (const header of text.matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g)) {
    const start = (header.index ?? 0) + header[0].length;
    const stream = text.indexOf("stream", start);
    const end = text.indexOf("endobj", start);
    if (stream < 0 || (end >= 0 && end < stream)) continue;
    const dict = text.slice(start, stream);
    if (!/\/Type\s*\/EmbeddedFile\b/.test(dict)) continue;
    const length = lengthOf(text, dict);
    const dataStart = stream + 6 + (text[stream + 6] === "\r" ? 2 : 1);
    if (length === undefined) continue;
    const raw = bytes.subarray(dataStart, dataStart + length);
    try {
      found.push(new Uint8Array(/\/FlateDecode/.test(dict) ? inflateSync(raw) : raw));
    } catch {
      // A stream that does not inflate is not the attachment this reads; the caller finds none.
    }
  }
  return found;
};
