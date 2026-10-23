/**
 * Where a file a tool saves may land: the server's outbox folder, or a folder
 * INSIDE it. For a service the outbox is a directory its callers read and the
 * service alone writes (a Gmail attachment, an ANAF archive, a receipts
 * export); a path outside it is one the service cannot (and must not) write,
 * so it is refused with the remedy rather than failing on a permission error
 * halfway through a harvest.
 *
 * Pure string work, POSIX paths: `root` is absolute, `requested` is what the
 * caller sent.
 */
export type SaveDir = { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string };

const segmentsOf = (path: string): readonly string[] => path.split("/").filter((s) => s !== "" && s !== ".");

export const resolveSaveDir = (root: string, requested: string | undefined): SaveDir => {
  const base = `/${segmentsOf(root).join("/")}`;
  if (requested === undefined || requested.trim() === "") return { ok: true, dir: base };
  const wanted = requested.trim();
  const inside = wanted.startsWith("/") ? (wanted === base || wanted.startsWith(`${base}/`) ? wanted.slice(base.length) : undefined) : wanted;
  if (inside === undefined) {
    return { ok: false, reason: `save_dir must be a folder under ${base} (e.g. "2026-09/invoices"); copy the files from there to where they belong` };
  }
  const segments = segmentsOf(inside);
  if (segments.includes("..")) return { ok: false, reason: "save_dir may not climb out of the outbox with .." };
  return { ok: true, dir: [base, ...segments].join("/") };
};

/**
 * A file handed back, as MCP's `resource_link` content: a `file://` URI, the
 * file's name, its MIME type and its size. A client can show or open the file
 * from this without parsing the tool's JSON, which keeps naming the same file
 * by path with its SHA-256. The link is for the machine the server runs on, the
 * same machine whose path the JSON reports.
 */
export type ResourceLink = {
  readonly type: "resource_link";
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly size: number;
};

/** The types of the files these servers hand back, by extension. Unknown: no type, which the spec allows. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".eml": "message/rfc822",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ics": "text/calendar",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".jsonl": "application/jsonl",
  ".md": "text/markdown",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".pem": "application/x-pem-file",
  ".png": "image/png",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pwg": "image/pwg-raster",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
};

export const mimeTypeOf = (name: string): string | undefined => MIME_TYPES[extensionOf(name)];

/** The link to a saved file at an absolute POSIX path, every character of it escaped as a URI needs. */
export const resourceLinkTo = (path: string, size: number): ResourceLink => {
  const segments = segmentsOf(path);
  const name = segments.at(-1) ?? path;
  const mimeType = mimeTypeOf(name);
  return { type: "resource_link", uri: `file:///${segments.map(encodeURIComponent).join("/")}`, name, ...(mimeType === undefined ? {} : { mimeType }), size };
};
