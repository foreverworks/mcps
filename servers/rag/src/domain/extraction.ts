import type { Kind } from "./kinds.js";

/**
 * Raise this when extraction, normalisation or chunking changes what a file's
 * chunks hold: every file is then read again on its next run, though only the
 * chunks whose text changed are embedded again.
 *
 * 2: OCR forced on the pages without enough text (a stamped page number no
 * longer stops it), control characters dropped, UTF-16 text files, long words
 * cut.
 */
export const PIPELINE_VERSION = 2;

/**
 * How a file was read: what, besides its bytes, decides whether its stored
 * chunks are current. The language changes the OCR and the Romanian letters;
 * whether OCR ran changes only what PDFs and images give.
 */
export const extractionKey = (kind: Kind, options: { readonly language: string; readonly ocr: boolean }): string =>
  kind.kind === "pdf" || kind.kind === "image" ? `v${PIPELINE_VERSION} ${options.language} ocr=${options.ocr}` : `v${PIPELINE_VERSION} ${options.language}`;

/** The key of a document whose OCR failed or ran out of time: it never equals a wanted key, so the next run reads the file again. */
export const incompleteKey = (key: string): string => `${key} incomplete`;
