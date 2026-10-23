import { DOCUMENT_MIME, PRESENTATION_MIME, SPREADSHEET_MIME } from "./entries.js";
import type { RawFile } from "./schema.js";

/**
 * An upload's rules, pure: how large, what to do about a name already taken,
 * and whether what Drive stored is what was sent.
 */

/** The largest file this server uploads: what it holds in memory at once. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * A name already in the folder: refuse (the default, so nothing is replaced by
 * accident), give the one file of that name these bytes as a new revision (same
 * id, the old revision kept), or add a second file of the same name, which
 * Drive allows.
 */
export const IF_EXISTS = ["fail", "replace", "keep_both"] as const;
export type IfExists = (typeof IF_EXISTS)[number];

export type Stored = { readonly verifiedBy: "sha256" | "md5" } | { readonly mismatch: string } | { readonly unverified: string };

/**
 * What Drive says it stored, against the source's hashes. Drive's sha256 is the
 * check; its md5 the fallback for a file it reports none for. A file Drive
 * reports neither for cannot be called verified, and says so.
 */
export const storedCheck = (stored: RawFile, source: { readonly sha256: string; readonly md5: string }): Stored => {
  if (stored.sha256Checksum) {
    return stored.sha256Checksum === source.sha256
      ? { verifiedBy: "sha256" }
      : { mismatch: `Drive stored sha256 ${stored.sha256Checksum}, the source is ${source.sha256}` };
  }
  if (stored.md5Checksum) {
    return stored.md5Checksum === source.md5
      ? { verifiedBy: "md5" }
      : { mismatch: `Drive stored md5 ${stored.md5Checksum}, the source is ${source.md5}` };
  }
  return { unverified: "Drive reported no checksum for the stored file" };
};

const segmentsOf = (path: string): readonly string[] => path.split("/").filter((s) => s !== "" && s !== ".");

/**
 * The folder a file in the Drive mirror stands for: its directory below the
 * mirror's root, as a path under My Drive ("" for the root itself), or
 * undefined for a file that is not in the mirror. Pure string work on two
 * absolute POSIX paths; the reader has already resolved links.
 */
export const mirroredFolder = (mirror: string, file: string): string | undefined => {
  const root = segmentsOf(mirror);
  const path = segmentsOf(file);
  if (path.includes("..") || path.length <= root.length || root.some((segment, i) => path[i] !== segment)) return undefined;
  return path.slice(root.length, -1).join("/");
};

/**
 * What an Office file becomes when it is uploaded as a Google file: Drive
 * converts on the way in when the metadata names the Google type and the bytes
 * go with their own. Only these: the formats Docs, Sheets and Slides open as
 * their own, so nothing is converted into a type that reads it badly.
 */
const CONVERSIONS: Readonly<Record<string, string>> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": DOCUMENT_MIME,
  "application/msword": DOCUMENT_MIME,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": SPREADSHEET_MIME,
  "application/vnd.ms-excel": SPREADSHEET_MIME,
  "text/csv": SPREADSHEET_MIME,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": PRESENTATION_MIME,
  "application/vnd.ms-powerpoint": PRESENTATION_MIME,
};

/** The Google type a file of this type converts to, or undefined when it does not convert. */
export const conversionOf = (sourceMime: string): string | undefined => CONVERSIONS[sourceMime];

/** A converted file is named as Drive names one converted by hand: without the Office extension it no longer has. Any other dot stays. */
export const convertedName = (name: string): string => name.replace(/\.(docx|doc|xlsx|xls|csv|pptx|ppt)$/i, "") || name;
