/**
 * The part of CBOR (RFC 8949) a WebAuthn authenticator writes: unsigned and
 * negative integers, byte strings, text strings, arrays and maps. Pure.
 *
 * Maps are written in CTAP2's canonical order (RFC 8949 section 4.2.3, the
 * "length-first" order CTAP2 and RFC 7049 section 3.9 use): keys sorted by the
 * length of their encoding, then by its bytes. So the integer keys of a COSE
 * key come out 1, 3, -1, -2, -3, and an attestation object's text keys as
 * "fmt", "attStmt", "authData", which is what a browser's own authenticator
 * sends and what a strict verifier expects. Nothing here decodes: the server
 * only ever writes CBOR.
 *
 * Written here rather than taken from a package: about sixty lines with a
 * test against RFC 8949's own examples (Appendix A), where a dependency would
 * bring a decoder and floats and tags this server never uses.
 */

export type Cbor = number | string | Uint8Array | readonly Cbor[] | CborMap;
/** A map's entries; keys are integers or text, as CTAP2 allows. */
export type CborMap = { readonly map: ReadonlyArray<readonly [number | string, Cbor]> };

const UTF8 = new TextEncoder();

/** The initial byte and the argument, in the shortest form (RFC 8949 section 4.2.1). */
const head = (major: number, value: number): number[] => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`CBOR argument out of range: ${value}`);
  const type = major << 5;
  if (value < 24) return [type | value];
  if (value < 0x100) return [type | 24, value];
  if (value < 0x10000) return [type | 25, value >> 8, value & 0xff];
  const width = value < 0x100000000 ? 4 : 8;
  const big = BigInt(value);
  const bytes = Array.from({ length: width }, (_, i) => Number((big >> BigInt(8 * (width - 1 - i))) & BigInt(0xff)));
  return [type | (width === 4 ? 26 : 27), ...bytes];
};

const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

const encodeInto = (value: Cbor, out: number[]): void => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new RangeError(`CBOR integers only: ${value}`);
    out.push(...(value >= 0 ? head(0, value) : head(1, -1 - value)));
  } else if (typeof value === "string") {
    const bytes = UTF8.encode(value);
    out.push(...head(3, bytes.length), ...bytes);
  } else if (value instanceof Uint8Array) {
    out.push(...head(2, value.length), ...value);
  } else if (Array.isArray(value)) {
    out.push(...head(4, value.length));
    for (const item of value) encodeInto(item, out);
  } else {
    const map = (value as CborMap).map;
    const entries = map.map(([key, item]) => ({ key: encodeCbor(key), item }));
    entries.sort((a, b) => compareBytes(a.key, b.key));
    for (let i = 1; i < entries.length; i++) {
      if (compareBytes(entries[i - 1]!.key, entries[i]!.key) === 0) throw new RangeError("CBOR map with a repeated key");
    }
    out.push(...head(5, entries.length));
    for (const { key, item } of entries) {
      out.push(...key);
      encodeInto(item, out);
    }
  }
};

export const encodeCbor = (value: Cbor): Uint8Array => {
  const out: number[] = [];
  encodeInto(value, out);
  return Uint8Array.from(out);
};

export const cborMap = (...entries: ReadonlyArray<readonly [number | string, Cbor]>): CborMap => ({ map: entries });
