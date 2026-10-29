import { callSignal, reportProgress } from "@foreverworks/mcp-kit";

import { chunkDocument } from "../../domain/chunk.js";
import { asAppError, describeFailure, fail, inputError } from "../../domain/errors.js";
import { kindOf, SUPPORTED_EXTENSIONS } from "../../domain/kinds.js";
import { normaliseText } from "../../domain/text.js";
import type { Deps } from "../ports.js";
import { assertSameModel, embeddingModel, findCollection } from "./collections.js";

/** How many entries each list in a reply shows; the counts always cover everything. */
const LISTED = 25;

export type IndexArgs = {
  readonly collection: string;
  readonly path: string;
  readonly recursive: boolean;
  readonly language?: string | undefined;
  readonly ocr: boolean;
  readonly force: boolean;
  readonly prune: boolean;
  readonly maxFiles: number;
};

type Outcome =
  | { readonly status: "indexed"; readonly source: string; readonly chunks: number; readonly added: number; readonly kept: number; readonly removed: number; readonly ocrPages?: number | undefined; readonly warnings?: readonly string[] }
  | { readonly status: "unchanged"; readonly source: string }
  | { readonly status: "skipped"; readonly source: string; readonly reason: string }
  | { readonly status: "failed"; readonly source: string; readonly error: string };

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Embeds texts in batches the endpoint accepts, keeping their order. */
const embedAll = async (deps: Deps, texts: readonly string[]): Promise<readonly (readonly number[])[]> => {
  const out: (readonly number[])[] = [];
  for (let i = 0; i < texts.length; i += deps.settings.embedBatch) out.push(...(await deps.embedder.embed(texts.slice(i, i + deps.settings.embedBatch))));
  if (out.length !== texts.length) return fail({ kind: "model", endpoint: "embed", message: `asked for ${texts.length} vectors, got ${out.length}` });
  return out;
};

const indexOne = async (deps: Deps, collection: string, source: string, args: IndexArgs, language: string): Promise<Outcome> => {
  const kind = kindOf(source);
  if (kind === undefined) return { status: "skipped", source, reason: "not a format this server reads" };
  const file = await deps.sources.read({ path: source });
  const existing = await deps.store.document(collection, source);
  if (existing !== undefined && existing.sha256 === file.sha256 && !args.force) return { status: "unchanged", source };
  const extracted = await deps.extractor.extract({ name: basename(source), bytes: file.bytes, kind }, { language, ocr: args.ocr });
  const sections = extracted.sections.map((s) => ({ location: s.location, text: normaliseText(s.text, language) }));
  const chunks = chunkDocument(source, sections);
  if (chunks.length === 0) return { status: "skipped", source, reason: extracted.warnings.join("; ") || "no text found" };
  const known = await deps.store.chunkIds(collection, source);
  const fresh = chunks.filter((c) => !known.has(c.id));
  const vectors = await embedAll(deps, fresh.map((c) => c.body));
  const byId = new Map(fresh.map((c, i) => [c.id, vectors[i]]));
  const saved = await deps.store.saveDocument(
    collection,
    { source, sha256: file.sha256, size: file.size, kind: kind.kind, pages: extracted.pages },
    chunks.map((c) => ({ ...c, embedding: byId.get(c.id) })),
  );
  return {
    status: "indexed",
    source,
    chunks: chunks.length,
    ...saved,
    ...(extracted.ocrPages ? { ocrPages: extracted.ocrPages } : {}),
    ...(extracted.warnings.length > 0 ? { warnings: extracted.warnings } : {}),
  };
};

/**
 * Indexes one file, or the files of a folder: text extracted (with OCR for
 * pages that have none), cut into chunks with stable ids, and only the chunks
 * not stored already are embedded. A file whose sha256 is unchanged is not
 * read past its bytes. A failure on one file is reported and the rest go on.
 */
export const indexPath = async (deps: Deps, args: IndexArgs) => {
  const collection = await findCollection(deps, args.collection);
  assertSameModel(collection, await embeddingModel(deps));
  const language = args.language?.trim() || deps.settings.language;
  if (!/^[a-z_]+(\+[a-z_]+)*$/u.test(language)) return fail(inputError(`"${language}" is not a tesseract language: codes such as eng, ron or ron+eng`));
  const listing = await deps.sources.list(args.path, { recursive: args.recursive, limit: args.maxFiles });
  const outcomes: Outcome[] = [];
  for (const [i, source] of listing.files.entries()) {
    if (callSignal()?.aborted === true) break;
    reportProgress(i, listing.files.length, basename(source));
    try {
      outcomes.push(await indexOne(deps, collection.name, source, args, language));
    } catch (thrown) {
      const kind = asAppError(thrown)?.kind;
      // A database that went away fails every file the same way: stop rather than list it N times.
      if (kind === "database" || kind === "config" || kind === "mismatch") throw thrown;
      outcomes.push({ status: "failed", source, error: describeFailure(thrown) });
    }
  }
  const cancelled = outcomes.length < listing.files.length;
  const seen = new Set(listing.files);
  const pruned = args.prune && listing.folder && !listing.truncated && !cancelled ? await deps.store.removeSources(collection.name, listing.path, seen) : 0;
  const of = <S extends Outcome["status"]>(status: S) => outcomes.filter((o): o is Extract<Outcome, { status: S }> => o.status === status);
  const indexed = of("indexed");
  return {
    collection: collection.name,
    path: listing.path,
    files: listing.files.length,
    indexed: indexed.length,
    unchanged: of("unchanged").length,
    skipped: of("skipped").length,
    failed: of("failed").length,
    chunks_embedded: indexed.reduce((n, o) => n + o.added, 0),
    chunks_kept: indexed.reduce((n, o) => n + o.kept, 0),
    chunks_removed: indexed.reduce((n, o) => n + o.removed, 0),
    ...(args.prune ? { sources_pruned: pruned } : {}),
    ...(listing.links > 0 ? { links_not_followed: listing.links } : {}),
    ...(listing.truncated ? { truncated: true, next: `more than ${args.maxFiles} files: call again (unchanged files are passed over quickly) or raise max_files` } : {}),
    ...(cancelled ? { cancelled: true } : {}),
    ...(indexed.length > 0 ? { indexed_files: indexed.slice(0, LISTED) } : {}),
    ...(of("failed").length > 0 ? { failed_files: of("failed").slice(0, LISTED) } : {}),
    ...(of("skipped").length > 0 ? { skipped_files: of("skipped").slice(0, LISTED), readable: SUPPORTED_EXTENSIONS.join(", ") } : {}),
  };
};

export const removeSource = async (deps: Deps, args: { readonly collection: string; readonly path: string }) => {
  const collection = await findCollection(deps, args.collection);
  const path = args.path.trim();
  if (!path.startsWith("/")) return fail(inputError("give the absolute path the source was indexed under, as list_sources shows it"));
  const removed = await deps.store.removeSources(collection.name, path.replace(/\/+$/u, ""));
  return { collection: collection.name, path, documents_removed: removed };
};

export const listSources = async (deps: Deps, args: { readonly collection: string; readonly prefix?: string | undefined; readonly limit: number; readonly offset: number }) => {
  const collection = await findCollection(deps, args.collection);
  const { total, rows } = await deps.store.documents(collection.name, args);
  return { collection: collection.name, total, offset: args.offset, sources: rows, ...(args.offset + rows.length < total ? { next_offset: args.offset + rows.length } : {}) };
};

