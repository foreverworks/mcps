import { callSignal, reportProgress } from "@foreverworks/mcp-kit";
import { posix } from "node:path";

import { chunkDocument, type Chunk } from "../../domain/chunk.js";
import { asAppError, describeFailure, fail, inputError } from "../../domain/errors.js";
import { extractionKey, incompleteKey } from "../../domain/extraction.js";
import { kindOf, SUPPORTED_EXTENSIONS } from "../../domain/kinds.js";
import { addUsage, batches, NO_USAGE, type Usage } from "../../domain/provider.js";
import { normaliseText } from "../../domain/text.js";
import type { CollectionInfo, Deps, DocumentToStore } from "../ports.js";
import { assertSameModel, embeddingModel, findCollection } from "./collections.js";

/** How many entries each list in a reply shows; the counts always cover everything. */
const LISTED = 25;

/** Readable files one folder walk lists at most. Past it the listing is partial: prune does not run, and the reply says to go folder by folder. */
const MAX_LISTED = 100_000;

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
  | {
      readonly status: "indexed";
      readonly source: string;
      readonly chunks: number;
      readonly added: number;
      readonly kept: number;
      readonly removed: number;
      readonly usage: Usage;
      readonly ocrPages?: number | undefined;
      readonly warnings?: readonly string[];
    }
  | { readonly status: "unchanged"; readonly source: string }
  | { readonly status: "skipped"; readonly source: string; readonly reason: string }
  | { readonly status: "failed"; readonly source: string; readonly error: string };

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const cancelled = (): boolean => callSignal()?.aborted === true;

type Embedded = { readonly vectors: readonly (readonly number[])[]; readonly usage: Usage };

/**
 * Embeds texts where the collection's chunks are embedded, in batches that
 * provider accepts, keeping their order, and stops between batches when the
 * call is cancelled. A remote provider's usage is what it reported; the local
 * endpoint's counts requests and texts only.
 */
const embedAll = async (deps: Deps, collection: CollectionInfo, texts: readonly string[]): Promise<Embedded> => {
  const remote = collection.provider === "local" ? undefined : deps.remote[collection.provider];
  const vectors: (readonly number[])[] = [];
  let usage = NO_USAGE;
  for (const batch of batches(texts, remote?.batch ?? deps.settings.embedBatch)) {
    if (cancelled()) return fail(inputError("the call was cancelled"));
    if (remote === undefined) {
      vectors.push(...(await deps.embedder.embed(batch)));
      usage = addUsage(usage, { ...NO_USAGE, requests: 1, texts: batch.length });
    } else {
      const out = await remote.embed(batch);
      vectors.push(...out.vectors);
      usage = addUsage(usage, out.usage);
    }
  }
  if (vectors.length !== texts.length) return fail({ kind: "model", endpoint: "embed", message: `asked for ${texts.length} vectors, got ${vectors.length}` });
  return { vectors, usage };
};

/**
 * Embeds the chunks the index does not hold and saves the document. The
 * chunks it means to keep were read before the save took the document's lock;
 * if another call removed some meanwhile, those are embedded and the save is
 * tried once more, so a document is never stored without chunks it claims.
 */
const save = async (deps: Deps, collection: CollectionInfo, document: DocumentToStore, chunks: readonly Chunk[]) => {
  let known = await deps.store.chunkIds(collection.name, document.source);
  const vectors = new Map<string, readonly number[]>();
  let usage = NO_USAGE;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const need = chunks.filter((c) => !known.has(c.id) && !vectors.has(c.id));
    const embedded = await embedAll(deps, collection, need.map((c) => c.body));
    usage = addUsage(usage, embedded.usage);
    need.forEach((c, i) => vectors.set(c.id, embedded.vectors[i] ?? []));
    const result = await deps.store.saveDocument(collection.name, document, chunks.map((c) => ({ ...c, embedding: known.has(c.id) ? undefined : vectors.get(c.id) })));
    // Spent whether or not the save went through: the provider was paid for the vectors.
    if (result.saved || attempt === 1) await deps.store.addSpent(collection.name, usage);
    if (result.saved) return { ...result, usage };
    const missing = new Set(result.missing);
    known = new Set([...known].filter((id) => !missing.has(id)));
  }
  return fail(inputError(`${document.source} was changed in the index by another call while this one indexed it; index it again`));
};

const indexOne = async (deps: Deps, collection: CollectionInfo, source: string, args: IndexArgs, language: string): Promise<Outcome> => {
  const kind = kindOf(source);
  if (kind === undefined) return { status: "skipped", source, reason: "not a format this server reads" };
  const wanted = extractionKey(kind, { language, ocr: args.ocr });
  const file = await deps.sources.read({ path: source });
  const existing = await deps.store.document(collection.name, source);
  if (existing !== undefined && existing.sha256 === file.sha256 && existing.extraction === wanted && !args.force) return { status: "unchanged", source };
  const extracted = await deps.extractor.extract({ name: basename(source), bytes: file.bytes, kind }, { language, ocr: args.ocr });
  const sections = extracted.sections.map((s) => ({ location: normaliseText(s.location, language), text: normaliseText(s.text, language) }));
  const chunks = chunkDocument(source, sections);
  // Saved even with no chunks: the old ones go, and an unchanged file with no text is not read (or OCRed) again on every run.
  const document = { source, sha256: file.sha256, size: file.size, kind: kind.kind, pages: extracted.pages, extraction: extracted.complete ? wanted : incompleteKey(wanted) };
  const saved = await save(deps, collection, document, chunks);
  if (chunks.length === 0) return { status: "skipped", source, reason: extracted.warnings.join("; ") || "no text found" };
  return {
    status: "indexed",
    source,
    chunks: chunks.length,
    added: saved.added,
    kept: saved.kept,
    removed: saved.removed,
    usage: saved.usage,
    ...(extracted.ocrPages ? { ocrPages: extracted.ocrPages } : {}),
    ...(extracted.warnings.length > 0 ? { warnings: extracted.warnings } : {}),
  };
};

/**
 * A failure every later file would meet as well, so the call stops rather than
 * listing it once per file: the configuration, a model mismatch, a database
 * that refused for its own reasons, an embed endpoint that did not answer.
 * Postgres's data exceptions (SQLSTATE class 22) and an endpoint that refused
 * one request are about that file's text, and the rest go on.
 */
const stopsTheCall = (thrown: unknown): boolean => {
  const e = asAppError(thrown);
  if (e === undefined) return false;
  switch (e.kind) {
    case "config":
    case "mismatch":
      return true;
    case "database":
      return !(e.code?.startsWith("22") ?? false);
    case "model":
      return e.status === undefined;
    case "provider":
      // A refusal of one request's texts is that file's; quota, token, rate and reachability are every file's.
      return e.reason !== "rejected";
    default:
      return false;
  }
};

/**
 * Indexes one file, or the files of a folder: text extracted (with OCR for
 * pages that have none), cut into chunks with stable ids, and only the chunks
 * not stored already are embedded. A file whose sha256 and way of reading are
 * unchanged is not read past its bytes, and does not count toward max_files,
 * so calling again goes on where the last call stopped. A failure on one file
 * is reported and the rest go on.
 */
export const indexPath = async (deps: Deps, args: IndexArgs) => {
  const started = deps.now().getTime();
  const collection = await findCollection(deps, args.collection);
  assertSameModel(collection, await embeddingModel(deps), deps);
  const language = args.language?.trim() || deps.settings.language;
  if (!/^[a-z_]+(\+[a-z_]+)*$/u.test(language)) return fail(inputError(`"${language}" is not a tesseract language: codes such as eng, ron or ron+eng`));
  const listing = await deps.sources.list(args.path, { recursive: args.recursive, limit: MAX_LISTED, readable: (name) => kindOf(name) !== undefined });
  const outcomes: Outcome[] = [];
  let read = 0;
  let more = false;
  let stopped = false;
  for (const [i, source] of listing.files.entries()) {
    if (cancelled()) {
      stopped = true;
      break;
    }
    if (read >= args.maxFiles) {
      more = true;
      break;
    }
    reportProgress(i, listing.files.length, basename(source));
    try {
      const outcome = await indexOne(deps, collection, source, args, language);
      outcomes.push(outcome);
      if (outcome.status !== "unchanged") read += 1;
    } catch (thrown) {
      if (stopsTheCall(thrown)) throw thrown;
      outcomes.push({ status: "failed", source, error: describeFailure(thrown) });
      read += 1;
    }
  }
  // A prune needs the whole listing, not the whole of it indexed: what is on disk is what it keeps.
  const pruneSkipped = !args.prune
    ? undefined
    : !listing.folder
      ? "the path is a file, not a folder"
      : listing.truncated
        ? "the folder was not listed in full"
        : stopped
          ? "the call was cancelled"
          : undefined;
  const pruned = args.prune && pruneSkipped === undefined ? await deps.store.prune(collection.name, listing.path, { present: new Set(listing.files), recursive: args.recursive }) : 0;
  const of = <S extends Outcome["status"]>(status: S) => outcomes.filter((o): o is Extract<Outcome, { status: S }> => o.status === status);
  const indexed = of("indexed");
  const usage = indexed.reduce((sum, o) => addUsage(sum, o.usage), NO_USAGE);
  const next = listing.truncated
    ? `the folder holds more than ${MAX_LISTED} readable files: index its folders one at a time`
    : more
      ? `${args.maxFiles} files were read in this call (max_files): call again to go on; files already indexed are passed over`
      : undefined;
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
    embedding: {
      provider: collection.provider,
      model: collection.provider_model,
      requests: usage.requests,
      texts: usage.texts,
      ...(collection.provider === "local" ? {} : { tokens: usage.tokens, neurons: usage.neurons }),
    },
    seconds: Math.round((deps.now().getTime() - started) / 100) / 10,
    ...(args.prune ? { sources_pruned: pruned, ...(pruneSkipped === undefined ? {} : { prune_skipped: pruneSkipped }) } : {}),
    ...(listing.unreadable > 0 ? { not_readable: listing.unreadable, readable: SUPPORTED_EXTENSIONS.join(", ") } : {}),
    ...(listing.links > 0 ? { links_not_followed: listing.links } : {}),
    ...(listing.truncated ? { truncated: true } : {}),
    ...(more ? { more: true } : {}),
    ...(next === undefined ? {} : { next }),
    ...(stopped ? { cancelled: true } : {}),
    ...(indexed.length > 0 ? { indexed_files: indexed.slice(0, LISTED).map(({ usage: _usage, ...o }) => o) } : {}),
    ...(of("failed").length > 0 ? { failed_files: of("failed").slice(0, LISTED) } : {}),
    ...(of("skipped").length > 0 ? { skipped_files: of("skipped").slice(0, LISTED) } : {}),
  };
};

export const removeSource = async (deps: Deps, args: { readonly collection: string; readonly path: string }) => {
  const collection = await findCollection(deps, args.collection);
  const given = args.path.trim();
  if (!given.startsWith("/")) return fail(inputError("give the absolute path the source was indexed under, as list_sources shows it"));
  const path = posix.normalize(given).replace(/\/+$/u, "");
  if (path === "") return fail(inputError("that is every source in the collection: drop_collection removes them all, and asks a person first"));
  const removed = await deps.store.removeSources(collection.name, path);
  return { collection: collection.name, path, documents_removed: removed };
};

export const listSources = async (deps: Deps, args: { readonly collection: string; readonly prefix?: string | undefined; readonly limit: number; readonly offset: number }) => {
  const collection = await findCollection(deps, args.collection);
  const { total, rows } = await deps.store.documents(collection.name, args);
  return { collection: collection.name, total, offset: args.offset, sources: rows, ...(args.offset + rows.length < total ? { next_offset: args.offset + rows.length } : {}) };
};

