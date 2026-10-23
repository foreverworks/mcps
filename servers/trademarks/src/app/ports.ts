/**
 * What the use cases need, stated as functions. infra/ satisfies them; nothing
 * in app/ or domain/ imports from infra/.
 */
import type { DocumentFilter, Mark, MarkDetail, MarkDocument, MarkHistory, Office } from "../domain/mark.js";
import type { SourceQuery } from "../domain/query.js";

export type SourcePage = {
  /** How many marks the register counted for the query, before this server's exact/word filter. */
  readonly found: number;
  /** The candidates it returned, best first by its own measure (at most 100). */
  readonly marks: readonly Mark[];
};

/** One office's register, through one source. */
export type RegisterPort = {
  readonly office: Office;
  /** Names the source in results and health: `uspto-tmsearch`, `euipo-api`. */
  readonly source: string;
  /** A documented API the office offers for this, rather than the backend of its search page. */
  readonly official: boolean;
  /** What `similar` reaches through this source, said in health. */
  readonly similarity: string;
  /** Whether its search can keep only marks whose goods and services hold given words; a source that cannot ignores `goods`. */
  readonly goods: boolean;
  readonly search: (query: SourceQuery) => Promise<SourcePage>;
  /** Not found is a `not_found` failure. */
  readonly get: (id: string) => Promise<MarkDetail>;
  /** The cheapest call that proves the source answers with what it holds; a `config` failure means not configured. */
  readonly probe: () => Promise<void>;
};

/** One office's case files: a mark's status history and its documents, by number. */
export type RecordsPort = {
  readonly office: Office;
  /** Names the source in results and health: `uspto-tsdr`. */
  readonly source: string;
  /** Not found is a `not_found` failure. */
  readonly history: (id: string) => Promise<MarkHistory>;
  readonly documents: (id: string) => Promise<readonly MarkDocument[]>;
  /** The documents the filter picks, as one PDF. */
  readonly bundle: (id: string, filter: DocumentFilter) => Promise<Uint8Array>;
  /** The cheapest call that proves the source answers with its key; a `config` failure means no key. */
  readonly probe: () => Promise<void>;
};

/** Where files a call hands back go, reported by path, SHA-256 and size. */
export type OutboxPort = {
  readonly save: (name: string, bytes: Uint8Array) => Promise<{ readonly path: string; readonly sha256: string; readonly size: number }>;
};

export type Deps = {
  readonly registers: readonly RegisterPort[];
  readonly records: readonly RecordsPort[];
  readonly outbox: OutboxPort;
  readonly now: () => number;
};
