/**
 * The IPP wire format (RFC 8010): a version, an operation or status code, a
 * request id, attribute groups, then the document. Only what a client needs:
 * requests are encoded, responses decoded, every value tag read, collections
 * included (`media-col-ready`), so an attribute the server does not use is
 * still parsed rather than skipped by guesswork.
 */

export const GROUP = { operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05 } as const;

export const TAG = {
  unsupported: 0x10,
  unknown: 0x12,
  noValue: 0x13,
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

export type Value =
  | { readonly tag: "integer" | "enum"; readonly value: number }
  | { readonly tag: "boolean"; readonly value: boolean }
  | { readonly tag: "string"; readonly syntax: number; readonly value: string }
  | { readonly tag: "octetString"; readonly value: Uint8Array }
  | { readonly tag: "dateTime"; readonly value: string }
  | { readonly tag: "resolution"; readonly x: number; readonly y: number; readonly units: "dpi" | "dpcm" | number }
  | { readonly tag: "range"; readonly lower: number; readonly upper: number }
  | { readonly tag: "collection"; readonly members: Attributes }
  | { readonly tag: "out-of-band"; readonly value: "unsupported" | "unknown" | "no-value" | number };

/** Attribute name to its values, in the order they came. */
export type Attributes = ReadonlyMap<string, readonly Value[]>;

export type Group = { readonly tag: number; readonly attributes: Attributes };

export type Message = {
  readonly version: readonly [number, number];
  /** The operation id in a request, the status code in a response. */
  readonly code: number;
  readonly requestId: number;
  readonly groups: readonly Group[];
  readonly data: Uint8Array;
};

/** What a request attribute may carry: strings with their syntax tag, integers, enums, booleans. */
export type OutValue =
  | { readonly tag: number; readonly value: string }
  | { readonly tag: typeof TAG.integer | typeof TAG.enum; readonly value: number }
  | { readonly tag: typeof TAG.boolean; readonly value: boolean };

export type OutAttribute = { readonly name: string; readonly values: readonly OutValue[] };
export type OutGroup = { readonly tag: number; readonly attributes: readonly OutAttribute[] };

export const keyword = (value: string): OutValue => ({ tag: TAG.keyword, value });
export const integer = (value: number): OutValue => ({ tag: TAG.integer, value });
export const enumValue = (value: number): OutValue => ({ tag: TAG.enum, value });

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

const valueBytes = (v: OutValue): Buffer => {
  if (v.tag === TAG.integer || v.tag === TAG.enum) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v.value as number);
    return b;
  }
  if (v.tag === TAG.boolean) return Buffer.from([v.value ? 1 : 0]);
  return Buffer.from(String(v.value), "utf8");
};

/** One request: the header, the groups (an operation group first, as the RFC requires), the end tag. Append the document after it. */
export const encodeRequest = (request: { readonly operation: number; readonly requestId: number; readonly groups: readonly OutGroup[] }): Buffer => {
  const parts: Buffer[] = [Buffer.from([2, 0]), u16(request.operation)];
  const id = Buffer.alloc(4);
  id.writeUInt32BE(request.requestId);
  parts.push(id);
  for (const group of request.groups) {
    parts.push(Buffer.from([group.tag]));
    for (const attribute of group.attributes) {
      attribute.values.forEach((value, i) => {
        const name = Buffer.from(i === 0 ? attribute.name : "", "utf8");
        const bytes = valueBytes(value);
        parts.push(Buffer.from([value.tag]), u16(name.length), name, u16(bytes.length), bytes);
      });
    }
  }
  parts.push(Buffer.from([GROUP.end]));
  return Buffer.concat(parts);
};

const STRING_TAGS: ReadonlySet<number> = new Set([
  TAG.text,
  TAG.name,
  TAG.keyword,
  TAG.uri,
  TAG.uriScheme,
  TAG.charset,
  TAG.naturalLanguage,
  TAG.mimeMediaType,
  TAG.memberAttrName,
]);

const dateTimeText = (b: Uint8Array): string => {
  if (b.length !== 11) return Buffer.from(b).toString("hex");
  const v = Buffer.from(b);
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  const sign = String.fromCharCode(v[8] as number);
  return `${pad(v.readUInt16BE(0), 4)}-${pad(v[2] as number)}-${pad(v[3] as number)}T${pad(v[4] as number)}:${pad(v[5] as number)}:${pad(v[6] as number)}.${v[7] as number}${sign}${pad(v[9] as number)}:${pad(v[10] as number)}`;
};

const decodeValue = (tag: number, bytes: Uint8Array): Value => {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (tag) {
    case TAG.integer:
      return { tag: "integer", value: b.length === 4 ? b.readInt32BE(0) : Number.NaN };
    case TAG.enum:
      return { tag: "enum", value: b.length === 4 ? b.readInt32BE(0) : Number.NaN };
    case TAG.boolean:
      return { tag: "boolean", value: b[0] === 1 };
    case TAG.dateTime:
      return { tag: "dateTime", value: dateTimeText(b) };
    case TAG.resolution: {
      const units = b.length === 9 ? (b[8] as number) : 0;
      return { tag: "resolution", x: b.readInt32BE(0), y: b.readInt32BE(4), units: units === 3 ? "dpi" : units === 4 ? "dpcm" : units };
    }
    case TAG.rangeOfInteger:
      return { tag: "range", lower: b.readInt32BE(0), upper: b.readInt32BE(4) };
    case TAG.textWithLanguage:
    case TAG.nameWithLanguage: {
      const langLength = b.readUInt16BE(0);
      const textLength = b.readUInt16BE(2 + langLength);
      return { tag: "string", syntax: tag, value: b.subarray(4 + langLength, 4 + langLength + textLength).toString("utf8") };
    }
    case TAG.unsupported:
      return { tag: "out-of-band", value: "unsupported" };
    case TAG.unknown:
      return { tag: "out-of-band", value: "unknown" };
    case TAG.noValue:
      return { tag: "out-of-band", value: "no-value" };
    default:
      if (STRING_TAGS.has(tag)) return { tag: "string", syntax: tag, value: b.toString("utf8") };
      if (tag < 0x20) return { tag: "out-of-band", value: tag };
      return { tag: "octetString", value: new Uint8Array(b) };
  }
};

type Raw = { readonly tag: number; readonly name: string; readonly bytes: Uint8Array };

/** Reads one value: tag, name, bytes. */
const readRaw = (buf: Buffer, at: number): { raw: Raw; next: number } => {
  const tag = buf[at] as number;
  const nameLength = buf.readUInt16BE(at + 1);
  const name = buf.subarray(at + 3, at + 3 + nameLength).toString("utf8");
  const valueAt = at + 3 + nameLength;
  const valueLength = buf.readUInt16BE(valueAt);
  const end = valueAt + 2 + valueLength;
  if (end > buf.length) throw new RangeError(`IPP value ${name || "(additional)"} runs past the message`);
  return { raw: { tag, name, bytes: buf.subarray(valueAt + 2, end) }, next: end };
};

/** A collection's members, from just after its begCollection to just after its endCollection. */
const readCollection = (buf: Buffer, start: number): { members: Attributes; next: number } => {
  const members = new Map<string, Value[]>();
  let member = "";
  let at = start;
  for (;;) {
    if (at >= buf.length) throw new RangeError("an IPP collection is not closed");
    const { raw, next } = readRaw(buf, at);
    at = next;
    if (raw.tag === TAG.endCollection) return { members, next: at };
    if (raw.tag === TAG.memberAttrName) {
      member = Buffer.from(raw.bytes).toString("utf8");
      continue;
    }
    const values = members.get(member) ?? [];
    if (raw.tag === TAG.begCollection) {
      const inner = readCollection(buf, at);
      at = inner.next;
      values.push({ tag: "collection", members: inner.members });
    } else values.push(decodeValue(raw.tag, raw.bytes));
    members.set(member, values);
  }
};

/** Decodes a message; throws a RangeError for one that is cut short or malformed. */
export const decodeMessage = (data: Uint8Array): Message => {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length < 9) throw new RangeError(`an IPP message of ${buf.length} bytes`);
  const groups: { tag: number; attributes: Map<string, Value[]> }[] = [];
  let current: { tag: number; attributes: Map<string, Value[]> } | undefined;
  let last = "";
  let at = 8;
  for (;;) {
    if (at >= buf.length) throw new RangeError("an IPP message with no end-of-attributes tag");
    const tag = buf[at] as number;
    if (tag === GROUP.end) {
      at += 1;
      break;
    }
    if (tag < 0x10) {
      current = { tag, attributes: new Map() };
      groups.push(current);
      last = "";
      at += 1;
      continue;
    }
    if (current === undefined) throw new RangeError("an IPP attribute outside any group");
    const { raw, next } = readRaw(buf, at);
    at = next;
    const name = raw.name === "" ? last : raw.name;
    last = name;
    const values = current.attributes.get(name) ?? [];
    if (raw.tag === TAG.begCollection) {
      const collection = readCollection(buf, at);
      at = collection.next;
      values.push({ tag: "collection", members: collection.members });
    } else values.push(decodeValue(raw.tag, raw.bytes));
    current.attributes.set(name, values);
  }
  return {
    version: [buf[0] as number, buf[1] as number],
    code: buf.readUInt16BE(2),
    requestId: buf.readUInt32BE(4),
    groups,
    data: new Uint8Array(buf.subarray(at)),
  };
};

/** Every attribute of the groups with this tag, merged (a response may carry several job or printer groups). */
export const groupAttributes = (message: Message, tag: number): Attributes => {
  const merged = new Map<string, readonly Value[]>();
  for (const g of message.groups) if (g.tag === tag) for (const [k, v] of g.attributes) merged.set(k, [...(merged.get(k) ?? []), ...v]);
  return merged;
};

export const strings = (attributes: Attributes, name: string): readonly string[] =>
  (attributes.get(name) ?? []).flatMap((v) => (v.tag === "string" ? [v.value] : []));

export const firstString = (attributes: Attributes, name: string): string | undefined => strings(attributes, name)[0];

export const numbers = (attributes: Attributes, name: string): readonly number[] =>
  (attributes.get(name) ?? []).flatMap((v) => (v.tag === "integer" || v.tag === "enum" ? [v.value] : []));

export const firstNumber = (attributes: Attributes, name: string): number | undefined => numbers(attributes, name)[0];

export const firstBoolean = (attributes: Attributes, name: string): boolean | undefined => {
  const v = attributes.get(name)?.[0];
  return v?.tag === "boolean" ? v.value : undefined;
};
