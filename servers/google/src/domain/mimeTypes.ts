/**
 * A file's media type from its extension, for the products that send bytes to
 * Google without one: a Gmail attachment, a Drive upload. Pure.
 */
/** Common types by extension; anything else goes as application/octet-stream. */
const TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  ics: "text/calendar",
  eml: "message/rfc822",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const mimeTypeFor = (filename: string): string =>
  TYPES[(/\.([^.]+)$/.exec(filename)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";
