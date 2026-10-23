import type { MimePart } from "./schema.js";

export type { MimePart };
/** Walking Gmail's MIME tree. Pure; knows nothing about HTTP or Gmail's API. */


/** Depth-first, the part itself included. */
export function* walkParts(part: MimePart): Generator<MimePart> {
  yield part;
  for (const sub of part.parts ?? []) yield* walkParts(sub);
}

/** Gmail encodes part bodies url-safe and unpadded. Undecodable input is not fatal. */
export const decodePartData = (data: string): string | undefined => {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
};

export type Header = { readonly name: string; readonly value: string };

/** The headers that have both a name and a value, which every header Gmail sends does. */
export const namedHeaders = (part: MimePart | undefined): readonly Header[] =>
  (part?.headers ?? []).flatMap((h) => (h.name && h.value != null ? [{ name: h.name, value: h.value }] : []));

export const headersOf = (part: MimePart | undefined): Readonly<Record<string, string>> =>
  Object.fromEntries(namedHeaders(part).map((h) => [h.name, h.value]));
