/**
 * What the use cases need, stated as functions. infra/ satisfies them; nothing
 * in app/ or domain/ imports from infra/.
 */
import type { InputFiles } from "@foreverworks/mcp-kit";

import type { Chunk, Section } from "../domain/chunk.js";
import type { Kind } from "../domain/kinds.js";
import type { Provider, ProbeResult, RemoteProvider, Usage } from "../domain/provider.js";

/** What a model endpoint says it serves. */
export type ModelInfo = { readonly model: string; readonly revision?: string | undefined };

export type Embedder = {
  readonly info: () => Promise<ModelInfo>;
  /** One vector per text, in order; the endpoint's batch limit is the port's to respect. */
  readonly embed: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>;
};

/**
 * An embedding service elsewhere serving the model the local endpoint serves,
 * used to index a collection set to it. Questions are always embedded locally.
 */
export type RemoteEmbedder = {
  readonly provider: RemoteProvider;
  /** The model as the provider names it. */
  readonly model: string;
  /** Texts per request. */
  readonly batch: number;
  /** The settings it lacks (an empty token file counts as missing), without calling it: health reports them and spends nothing. */
  readonly missing: () => Promise<readonly string[]>;
  /** One vector per text, in order, and what the provider says the request cost. */
  readonly embed: (texts: readonly string[]) => Promise<{ readonly vectors: readonly (readonly number[])[]; readonly usage: Usage }>;
};

export type Reranker = {
  readonly info: () => Promise<ModelInfo>;
  /** A relevance score per text, best first, each naming the text's index in the input. */
  readonly rerank: (query: string, texts: readonly string[]) => Promise<readonly { readonly index: number; readonly score: number }[]>;
};

export type Extracted = {
  readonly sections: readonly Section[];
  /** Pages in the file (PDF), when known. */
  readonly pages?: number | undefined;
  /** Pages read by OCR rather than from the file's own text. */
  readonly ocrPages?: number | undefined;
  readonly warnings: readonly string[];
  /** False when OCR failed or ran out of time: the file is read again on the next run instead of passed over. */
  readonly complete: boolean;
};

export type ExtractOptions = { readonly language: string; readonly ocr: boolean };

export type Extractor = {
  readonly extract: (file: { readonly name: string; readonly bytes: Buffer; readonly kind: Kind }, options: ExtractOptions) => Promise<Extracted>;
  /** Each external tool and its version, or what went wrong finding it. */
  readonly tools: () => Promise<Readonly<Record<string, string>>>;
};

/** The files a path names: one file, or the regular files of a folder in name order that this server reads. */
export type Listing = {
  readonly files: readonly string[];
  /** Regular files passed over because this server does not read their format. */
  readonly unreadable: number;
  /** Symbolic links met on the way, never followed. */
  readonly links: number;
  /** The walk stopped at its limit: more files exist, and the listing is not the whole folder. */
  readonly truncated: boolean;
  /** Whether the path was a folder (a prune is only meaningful then). */
  readonly folder: boolean;
  /** The path as resolved: absolute, inside a root. */
  readonly path: string;
};

export type Sources = {
  /** Reads one file byte for byte, inside a root, with its sha256. */
  readonly read: InputFiles;
  readonly list: (path: string, options: { readonly recursive: boolean; readonly limit: number; readonly readable: (name: string) => boolean }) => Promise<Listing>;
  readonly roots: readonly string[];
};

/** A collection as recorded, without counting what it holds. */
export type CollectionInfo = {
  readonly name: string;
  readonly description: string;
  /** The local embed endpoint's model and dimension: every question is embedded with it. */
  readonly model: string;
  readonly dimension: number;
  readonly created: string;
  /** Where its chunks are embedded, and that provider's name for the model (the local one's, for local). */
  readonly provider: Provider;
  readonly provider_model: string;
  /** The probe that let it use a remote provider. */
  readonly provider_probe?: ProbeResult | undefined;
  /** What indexing it has cost at remote providers, as they reported it. */
  readonly spent_tokens: number;
  readonly spent_neurons: number;
};

/** Where a collection's chunks are embedded, as create_collection records it. */
export type ProviderSetting = { readonly provider: Provider; readonly provider_model: string; readonly provider_probe?: ProbeResult | undefined };

export type CollectionRow = CollectionInfo & { readonly documents: number; readonly chunks: number };

export type DocumentRow = {
  readonly source: string;
  readonly sha256: string;
  readonly size: number;
  readonly kind: string;
  readonly pages: number | undefined;
  /** How the text was read (extraction.ts): a file is passed over only when this and its sha256 are unchanged. */
  readonly extraction: string;
  readonly chunks: number;
  readonly indexed: string;
};

export type DocumentToStore = Omit<DocumentRow, "chunks" | "indexed">;

/**
 * What a save did, or, when chunks it was told to keep were gone by the time
 * it held the document's lock (another call removed or re-indexed it
 * meanwhile), which ones: nothing was written, and they need embedding.
 */
export type SaveResult =
  | { readonly saved: true; readonly added: number; readonly kept: number; readonly removed: number }
  | { readonly saved: false; readonly missing: readonly string[] };

export type StoredChunk = Chunk & { readonly collection: string; readonly source: string };

/** A chunk to write: its embedding only when it is new, an existing one keeps the one it has. */
export type ChunkToStore = Chunk & { readonly embedding?: readonly number[] | undefined };

export type Hit = { readonly collection: string; readonly id: string; readonly value: number };

export type SearchScope = { readonly collections: readonly string[]; readonly sourcePrefix?: string | undefined };

export type StoreStatus = {
  readonly vector: string | undefined;
  readonly unaccent: string | undefined;
  /** The embedding dimension the tables were made for, when they exist. */
  readonly dimension: number | undefined;
  readonly collections: number;
};

export type Store = {
  readonly status: () => Promise<StoreStatus>;
  /** Creates the extensions it may and the tables, for vectors of this dimension; a no-op when they exist. */
  readonly ensureSchema: (dimension: number) => Promise<void>;
  readonly collections: () => Promise<readonly CollectionRow[]>;
  /** The collections as recorded, without the counts: what a call checks before it works on one. */
  readonly collectionInfos: () => Promise<readonly CollectionInfo[]>;
  readonly createCollection: (row: { readonly name: string; readonly description: string; readonly model: string; readonly dimension: number } & ProviderSetting) => Promise<boolean>;
  /** Sets where an existing collection's chunks are embedded; false when there is no such collection. */
  readonly setProvider: (name: string, setting: ProviderSetting) => Promise<boolean>;
  /** Adds what a remote provider reported for indexing into the collection. */
  readonly addSpent: (name: string, usage: Usage) => Promise<void>;
  /** Removes the collection and everything indexed in it; how many documents and chunks went. */
  readonly dropCollection: (name: string) => Promise<{ readonly documents: number; readonly chunks: number } | undefined>;
  readonly document: (collection: string, source: string) => Promise<DocumentRow | undefined>;
  readonly chunkIds: (collection: string, source: string) => Promise<ReadonlySet<string>>;
  /** Writes a document and its chunks in one transaction under the document's lock: chunks it no longer has are removed. */
  readonly saveDocument: (collection: string, document: DocumentToStore, chunks: readonly ChunkToStore[]) => Promise<SaveResult>;
  /** Removes the sources equal to the path or under it as a folder; how many documents went. */
  readonly removeSources: (collection: string, path: string) => Promise<number>;
  /**
   * Removes the sources in a folder that are not among `present`: every level
   * below it, or only its own files when not recursive. Paths with a part that
   * starts with a dot are left alone, since a folder walk never lists them.
   */
  readonly prune: (collection: string, folder: string, options: { readonly present: ReadonlySet<string>; readonly recursive: boolean }) => Promise<number>;
  readonly documents: (collection: string, options: { readonly prefix?: string | undefined; readonly limit: number; readonly offset: number }) => Promise<{ readonly total: number; readonly rows: readonly DocumentRow[] }>;
  /** Nearest by cosine; value is the cosine similarity. */
  readonly nearest: (scope: SearchScope, embedding: readonly number[], limit: number) => Promise<readonly Hit[]>;
  /** Full-text matches of any word of the query; value is the rank. */
  readonly matching: (scope: SearchScope, query: string, limit: number) => Promise<readonly Hit[]>;
  readonly chunks: (keys: readonly { readonly collection: string; readonly id: string }[]) => Promise<readonly StoredChunk[]>;
  /** The chunks of one document from ordinal `from` to `to` inclusive, in order. */
  readonly range: (collection: string, source: string, from: number, to: number) => Promise<readonly StoredChunk[]>;
};

export type Settings = {
  /** The OCR language(s) when a call names none, as tesseract's codes (`eng`, `ron`, `ron+eng`). */
  readonly language: string;
  readonly embedBatch: number;
  /** Passages per rerank request: text-embeddings-inference refuses more than its --max-client-batch-size (32 by default). */
  readonly rerankBatch: number;
  /** Files indexed at once for a collection embedded at a remote provider (the local endpoint takes one at a time). */
  readonly remoteConcurrency: number;
};

export type Deps = {
  readonly store: Store;
  readonly embedder: Embedder;
  readonly remote: Readonly<Record<RemoteProvider, RemoteEmbedder>>;
  readonly reranker: Reranker;
  readonly extractor: Extractor;
  readonly sources: Sources;
  readonly settings: Settings;
  readonly now: () => Date;
};
