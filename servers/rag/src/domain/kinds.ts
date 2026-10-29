/**
 * Which extractor reads a file, decided by its extension: the bytes of a .docx
 * and an .odt are both ZIP archives, and pandoc needs to be told which it has.
 */
export type Kind =
  | { readonly kind: "pdf" }
  | { readonly kind: "image" }
  | { readonly kind: "pandoc"; readonly from: string }
  | { readonly kind: "markdown" }
  | { readonly kind: "text" };

const BY_EXTENSION: Readonly<Record<string, Kind>> = {
  pdf: { kind: "pdf" },
  png: { kind: "image" },
  jpg: { kind: "image" },
  jpeg: { kind: "image" },
  tif: { kind: "image" },
  tiff: { kind: "image" },
  bmp: { kind: "image" },
  webp: { kind: "image" },
  docx: { kind: "pandoc", from: "docx" },
  odt: { kind: "pandoc", from: "odt" },
  rtf: { kind: "pandoc", from: "rtf" },
  epub: { kind: "pandoc", from: "epub" },
  html: { kind: "pandoc", from: "html" },
  htm: { kind: "pandoc", from: "html" },
  md: { kind: "markdown" },
  markdown: { kind: "markdown" },
  txt: { kind: "text" },
  text: { kind: "text" },
  csv: { kind: "text" },
};

/** The extensions this server reads, for a reply that says why a file was skipped. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(BY_EXTENSION);

export const kindOf = (name: string): Kind | undefined => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
};
