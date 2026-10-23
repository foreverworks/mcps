import { mimeTypeOf } from "@foreverworks/mcp-kit";

import { present } from "./present.js";
import type { RawBlock, RawPropertyValue } from "./schema.js";

/**
 * A page's files, in and out. In: a file read by path is uploaded to Notion
 * and attached to a files column or as a block in the page's body. Out:
 * the files Notion hosts for a page (its files columns, and the file, image,
 * PDF, video and audio blocks of its body) are listed with where they sit, to
 * be saved to the outbox. An external link is listed, never fetched: it can
 * point anywhere.
 */

/** A file Notion hosts: a signed link, valid about an hour. */
export type HostedFile = { readonly name: string; readonly url: string; readonly from: string };
/** A link a person pasted: listed, not downloaded. */
export type ExternalFile = { readonly name: string; readonly url: string; readonly from: string };
export type PageFiles = { readonly hosted: readonly HostedFile[]; readonly external: readonly ExternalFile[] };

/** Notion's largest file sent in one request; a larger one needs a multi-part upload, which this server does not do. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** The largest file saved to the outbox: held in memory whole while it is checked and written. */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** The last part of a link's path, decoded: what a file block shows when it has no name of its own. */
export const nameFromUrl = (url: string): string => {
  try {
    const last = new URL(url).pathname.split("/").filter((s) => s !== "").pop() ?? "";
    return decodeURIComponent(last) || "file";
  } catch {
    return "file";
  }
};

/**
 * A name that is safe as one file in a folder: no path, no control characters,
 * no leading dot, at most 200 characters; "file" when nothing is left.
 */
export const safeFileName = (name: string): string => {
  const cleaned = [...name.normalize("NFC")]
    .map((c) => (c === "/" || c === "\\" || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? "_" : c))
    .join("")
    .trim()
    .replace(/^\.+/, "");
  const short = [...cleaned].slice(0, 200).join("");
  return short === "" ? "file" : short;
};

/** Each name once: a repeat gets " (2)", " (3)"... before its extension. */
export const uniqueNames = (names: readonly string[]): readonly string[] => {
  const taken = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
};

type FileItem =
  | { readonly type: "file"; readonly name?: string | null; readonly file: { readonly url: string } }
  | { readonly type: "external"; readonly name?: string | null; readonly external: { readonly url: string } }
  | { readonly type: string; readonly name?: string | null };

const sorted = (items: readonly FileItem[], from: string): { hosted: HostedFile[]; external: ExternalFile[] } => {
  const hosted: HostedFile[] = [];
  const external: ExternalFile[] = [];
  for (const item of items) {
    if (item.type === "file" && "file" in item) hosted.push({ name: item.name || nameFromUrl(item.file.url), url: item.file.url, from });
    else if (item.type === "external" && "external" in item) external.push({ name: item.name || nameFromUrl(item.external.url), url: item.external.url, from });
  }
  return { hosted, external };
};

/** The files in a page's files columns, every one or the one named, each labelled with its column. */
export const filesOfProperties = (properties: Readonly<Record<string, RawPropertyValue | null>>, only?: string): PageFiles => {
  const lists = present(properties)
    .filter(([name, raw]) => raw.type === "files" && (only === undefined || name === only))
    .map(([name, raw]) => sorted((raw as { readonly files: readonly FileItem[] }).files, name));
  return { hosted: lists.flatMap((l) => l.hosted), external: lists.flatMap((l) => l.external) };
};

/** The block types that carry a file. */
export const FILE_BLOCKS = ["file", "image", "pdf", "video", "audio"] as const;
export type FileBlockType = (typeof FILE_BLOCKS)[number];

/** The files in a page's body blocks, each labelled with its block. */
export const filesOfBlocks = (blocks: readonly RawBlock[]): PageFiles => {
  const lists = blocks.flatMap((b) => {
    if (!(FILE_BLOCKS as readonly string[]).includes(b.type)) return [];
    const item = (b as unknown as Record<string, FileItem>)[b.type];
    return item === undefined ? [] : [sorted([item], `body (${b.type} block ${b.id})`)];
  });
  return { hosted: lists.flatMap((l) => l.hosted), external: lists.flatMap((l) => l.external) };
};

/** The block a file becomes in a page's body, from its type: an image, a PDF, a video, a sound, or a plain file. */
export const blockTypeFor = (contentType: string): FileBlockType => {
  const type = contentType.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "file";
};

/**
 * One file as `multipart/form-data` under the field `file`, as Notion's send
 * step takes it. The name is quoted with its quotes and line breaks escaped
 * (RFC 7578), so a name cannot end the header early.
 */
export const multipartFile = (boundary: string, name: string, contentType: string, bytes: Uint8Array): Uint8Array => {
  const quoted = name.replace(/["\r\n\\]/g, (c) => encodeURIComponent(c));
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quoted}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
};

/** Media types the kit's table leaves out, so a video or a sound becomes its own kind of block. */
const MEDIA: Readonly<Record<string, string>> = {
  ".m4a": "audio/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".heic": "image/heic",
};

/** A file's type from its name; unknown is octet-stream, which Notion resolves from the name itself. */
export const contentTypeOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot).toLowerCase();
  return mimeTypeOf(name) ?? MEDIA[extension] ?? "application/octet-stream";
};
