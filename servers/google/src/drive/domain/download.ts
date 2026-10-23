import { DOCUMENT_MIME, PRESENTATION_MIME, SPREADSHEET_MIME } from "./entries.js";
import { MAX_UPLOAD_BYTES } from "./upload.js";

/**
 * A download's rules, pure: how large, what a Google file can be saved as, and
 * what the saved file is called.
 */

/** The largest file this server downloads: held in memory once, like an upload. */
export const MAX_DOWNLOAD_BYTES = MAX_UPLOAD_BYTES;

const DRAWING_MIME = "application/vnd.google-apps.drawing";

type Format = { readonly mime: string; readonly ext: string };

const PDF: Format = { mime: "application/pdf", ext: "pdf" };

/**
 * What each kind of Google file can be saved as, the first being what it is
 * saved as when no format is given: the format an office would open. Drive
 * renders the export itself, so a native file has no checksum to verify.
 */
const EXPORTS: Readonly<Record<string, Readonly<Record<string, Format>>>> = {
  [DOCUMENT_MIME]: {
    pdf: PDF,
    docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
    odt: { mime: "application/vnd.oasis.opendocument.text", ext: "odt" },
    rtf: { mime: "application/rtf", ext: "rtf" },
    txt: { mime: "text/plain", ext: "txt" },
    md: { mime: "text/markdown", ext: "md" },
    html: { mime: "text/html", ext: "html" },
    epub: { mime: "application/epub+zip", ext: "epub" },
  },
  [SPREADSHEET_MIME]: {
    xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
    ods: { mime: "application/x-vnd.oasis.opendocument.spreadsheet", ext: "ods" },
    pdf: PDF,
    csv: { mime: "text/csv", ext: "csv" },
    tsv: { mime: "text/tab-separated-values", ext: "tsv" },
  },
  [PRESENTATION_MIME]: {
    pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
    odp: { mime: "application/vnd.oasis.opendocument.presentation", ext: "odp" },
    pdf: PDF,
    txt: { mime: "text/plain", ext: "txt" },
  },
  [DRAWING_MIME]: {
    png: { mime: "image/png", ext: "png" },
    pdf: PDF,
    svg: { mime: "image/svg+xml", ext: "svg" },
    jpg: { mime: "image/jpeg", ext: "jpg" },
  },
};

/** Every format a tool may be asked for, for its schema. */
export const DOWNLOAD_FORMATS = [...new Set(Object.values(EXPORTS).flatMap((formats) => Object.keys(formats)))] as [string, ...string[]];

export type ExportPlan = ({ readonly format: string } & Format) | { readonly refused: string };

/** How a Google file of `mimeType` is saved as `format` ("" for its default), or why it cannot be. */
export const exportPlan = (mimeType: string, format: string): ExportPlan => {
  const formats = EXPORTS[mimeType];
  if (formats === undefined) return { refused: `a ${mimeType} cannot be saved as a file; only Docs, Sheets, Slides and Drawings export` };
  const chosen = format === "" ? Object.keys(formats)[0] : format;
  const plan = chosen === undefined ? undefined : formats[chosen];
  if (chosen === undefined || plan === undefined) {
    return { refused: `a ${mimeType} saves as ${Object.keys(formats).join(", ")}, not ${format}` };
  }
  return { format: chosen, ...plan };
};

/**
 * The name a download is saved under: Drive's name (which may hold a slash, as
 * Google Meet's do) made safe for one path segment, with the export's
 * extension when it lacks it.
 */
export const downloadName = (name: string, ext?: string): string => {
  const safe = name.replace(/[/\0]/g, "_").trim().replace(/^\.+$/, "_") || "download";
  return ext === undefined || safe.toLowerCase().endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
};
