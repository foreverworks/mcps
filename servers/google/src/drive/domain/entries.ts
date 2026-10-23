import type { RawFile } from "./schema.js";
import { required } from "./errors.js";

export type { RawFile };
/**
 * The shape every tool returns for a file, and the one distinction Drive makes
 * that nothing else does.
 */

/** Google's own formats: Docs, Sheets, Slides, Forms, folders, shortcuts. */
export const NATIVE_PREFIX = "application/vnd.google-apps.";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOCUMENT_MIME = "application/vnd.google-apps.document";
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const PRESENTATION_MIME = "application/vnd.google-apps.presentation";


export type Entry = {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** A Google Doc/Sheet/Slide. It has no bytes to download and must be exported. */
  readonly isNative: boolean;
  readonly isFolder: boolean;
  readonly bytes: number | null;
  readonly modified: string | null;
  readonly trashed: boolean;
  readonly link: string | null;
  readonly parents?: readonly string[];
  readonly md5?: string;
  readonly sha256?: string;
};

export const isFolder = (mimeType: string): boolean => mimeType === FOLDER_MIME;

/** True for every Google-native type INCLUDING folders; callers usually want both flags. */
export const isNative = (mimeType: string): boolean => mimeType.startsWith(NATIVE_PREFIX);

/**
 * `bytes` is null rather than 0 for a native file, and that is deliberate.
 *
 * Drive reports no size for a Doc because a Doc has no stored bytes until it is
 * exported. A 0 there would read as "an empty document", which is an answer,
 * and the repo's rule is not to fill a field you cannot fill.
 */
export const shape = (raw: RawFile): Entry => {
  // The three every file is asked for (FILE_FIELDS); Drive always sends them, and a file without
  // them could be neither shown nor acted on, so their absence fails the call.
  const mimeType = required(raw.mimeType, "file mimeType");
  return {
    id: required(raw.id, "file id"),
    name: required(raw.name, "file name"),
    mimeType,
    isNative: isNative(mimeType),
    isFolder: isFolder(mimeType),
    bytes: raw.size == null ? null : Number(raw.size),
    modified: raw.modifiedTime ?? null,
    trashed: raw.trashed ?? false,
    link: raw.webViewLink ?? null,
    ...(raw.parents ? { parents: raw.parents } : {}),
    ...(raw.md5Checksum ? { md5: raw.md5Checksum } : {}),
    ...(raw.sha256Checksum ? { sha256: raw.sha256Checksum } : {}),
  };
};

/**
 * What a native file can be exported as.
 *
 * Text first on purpose: the caller is an agent reading a document, not a user
 * downloading one, and `text/plain` costs a fraction of the tokens a .docx
 * round-trip would. `text/markdown` is Google's own export for Docs and keeps
 * headings and lists, which is usually worth the extra bytes.
 */
export const EXPORT_MIME: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [DOCUMENT_MIME]: {
    text: "text/plain",
    markdown: "text/markdown",
    html: "text/html",
  },
  [SPREADSHEET_MIME]: {
    text: "text/csv",
    markdown: "text/csv",
    html: "text/html",
  },
  [PRESENTATION_MIME]: {
    text: "text/plain",
    markdown: "text/plain",
    html: "text/html",
  },
};

export const exportMimeFor = (mimeType: string, format: string): string | null =>
  EXPORT_MIME[mimeType]?.[format] ?? null;
