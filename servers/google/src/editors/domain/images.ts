import type { ApiRequest } from "./discovery.js";

/**
 * Where a request names a local image, and what it is. Pure.
 *
 * A request names one as "image:<name>" in the fields Docs and Slides read an
 * image URL from, and nowhere else, so text that happens to start with
 * "image:" is never touched.
 */

/** Docs: insertInlineImage.uri, replaceImage.uri. Slides: createImage.url, replaceImage.url, replaceAllShapesWithImage.imageUrl. */
const URL_KEYS = new Set(["uri", "url", "imageUrl"]);

const REFERENCE = /^image:([A-Za-z0-9_.-]{1,64})$/;

export const IMAGE_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

/** The size Docs and Slides take an image up to. */
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;

const walk = (value: unknown, visit: (key: string, text: string) => string | undefined): unknown => {
  if (Array.isArray(value)) return value.map((v) => walk(v, visit));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item === "string" && URL_KEYS.has(key)) return [key, visit(key, item) ?? item];
      return [key, walk(item, visit)];
    }),
  );
};

/** Every image name the requests use. */
export const imageReferences = (requests: readonly ApiRequest[]): ReadonlySet<string> => {
  const names = new Set<string>();
  walk(requests, (_, text) => {
    const name = REFERENCE.exec(text)?.[1];
    if (name) names.add(name);
    return undefined;
  });
  return names;
};

/** The requests with each "image:<name>" replaced by the URL given for it. */
export const substituteImages = (requests: readonly ApiRequest[], urls: Readonly<Record<string, string>>): readonly ApiRequest[] =>
  walk(requests, (_, text) => {
    const name = REFERENCE.exec(text)?.[1];
    return name ? urls[name] : undefined;
  }) as readonly ApiRequest[];

/** PNG, JPEG or GIF, by their first bytes: the formats Docs and Slides insert. */
export const imageKind = (bytes: Uint8Array): string | undefined => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  return undefined;
};
