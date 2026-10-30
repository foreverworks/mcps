import { createHash } from "node:crypto";
import type pg from "pg";

import type { ChunkToStore, CollectionInfo, CollectionRow, DocumentRow, Hit, SaveResult, SearchScope, Store, StoredChunk } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import type { ProbeResult } from "../domain/provider.js";
import type { Pool } from "./database.js";

/**
 * The index in Postgres with pgvector: collections, the documents in each
 * (one per source path, with the sha256 that makes a re-run incremental) and
 * their chunks, each with its embedding and a full-text vector with accents
 * removed (GIN). Every name is prefixed rag_ so the tables can share a database.
 *
 * Each collection has an HNSW index of its own (cosine), partial on its name, as
 * pgvector advises for a filter of few values: collections embedded by different
 * models share the table but never a graph, whose neighbours would otherwise be
 * vectors from another model's space, and a search reads only its collection's
 * graph. Tables made before that had one index for every collection
 * (rag_chunk_embedding); ensureIndex builds a collection's own and drops that
 * one once no collection needs it.
 *
 * `vector` must already exist in the database, or the role must be allowed to
 * create it: pgvector is not a trusted extension, so it is usually created by
 * the database's administrator. `unaccent` is trusted, and the database owner
 * creates it here.
 */

const vectorText = (v: readonly number[]): string => `[${v.join(",")}]`;

const asDatabaseError = (thrown: unknown): never => {
  const e = thrown as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : String(thrown);
  return fail(typeof e.code === "string" ? { kind: "database", message, code: e.code } : { kind: "database", message });
};

/** Runs a query, mapping a driver failure to this server's database error. */
const query = async <R extends pg.QueryResultRow>(db: Pool | pg.PoolClient, text: string, values: readonly unknown[] = []): Promise<pg.QueryResult<R>> => {
  try {
    return await db.query<R>(text, values as unknown[]);
  } catch (thrown) {
    // Ours already (a failure inside a callback): keep it.
    if (typeof thrown === "object" && thrown !== null && "kind" in thrown) throw thrown;
    return asDatabaseError(thrown);
  }
};

const inTransaction = async <T>(pool: Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (thrown) {
    return asDatabaseError(thrown);
  }
  try {
    await query(client, "BEGIN");
    const out = await work(client);
    await query(client, "COMMIT");
    return out;
  } catch (thrown) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw thrown;
  } finally {
    client.release();
  }
};

/**
 * Columns added after the first release, for tables made before them: where a
 * collection's chunks are embedded (local, which is what embedded them then)
 * and what a remote provider has cost it.
 */
const UPGRADES: readonly string[] = [
  "ALTER TABLE rag_collection ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'local'",
  "ALTER TABLE rag_collection ADD COLUMN IF NOT EXISTS provider_model text NOT NULL DEFAULT ''",
  "ALTER TABLE rag_collection ADD COLUMN IF NOT EXISTS provider_probe jsonb",
  "ALTER TABLE rag_collection ADD COLUMN IF NOT EXISTS spent_tokens bigint NOT NULL DEFAULT 0",
  "ALTER TABLE rag_collection ADD COLUMN IF NOT EXISTS spent_neurons double precision NOT NULL DEFAULT 0",
];

const schemaSql = (dimension: number): readonly string[] => [
  "CREATE EXTENSION IF NOT EXISTS vector",
  "CREATE EXTENSION IF NOT EXISTS unaccent",
  "CREATE TABLE IF NOT EXISTS rag_meta (key text PRIMARY KEY, value text NOT NULL)",
  `INSERT INTO rag_meta (key, value) VALUES ('dimension', '${dimension}') ON CONFLICT (key) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS rag_collection (
     name text PRIMARY KEY, description text NOT NULL DEFAULT '', model text NOT NULL,
     dimension integer NOT NULL, created timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS rag_document (
     collection text NOT NULL REFERENCES rag_collection (name) ON DELETE CASCADE,
     source text NOT NULL, sha256 text NOT NULL, size bigint NOT NULL, kind text NOT NULL, pages integer,
     extraction text NOT NULL DEFAULT '', indexed timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, source))`,
  // Tables made before the column existed: their documents read as extracted some other way, so each is read once more.
  "ALTER TABLE rag_document ADD COLUMN IF NOT EXISTS extraction text NOT NULL DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS rag_chunk (
     collection text NOT NULL, source text NOT NULL, id text NOT NULL, ordinal integer NOT NULL,
     location text NOT NULL, body text NOT NULL, embedding vector(${dimension}) NOT NULL, fts tsvector NOT NULL,
     PRIMARY KEY (collection, id),
     FOREIGN KEY (collection, source) REFERENCES rag_document (collection, source) ON DELETE CASCADE)`,
  ...UPGRADES,
  "CREATE INDEX IF NOT EXISTS rag_chunk_fts ON rag_chunk USING gin (fts)",
  "CREATE INDEX IF NOT EXISTS rag_chunk_document ON rag_chunk (collection, source, ordinal)",
];

/** The index every collection shared before each had its own. */
const SHARED_INDEX = "rag_chunk_embedding";

/**
 * A collection's own vector index: its name hashed, as the collection name may be 63 characters with
 * dashes; Postgres's md5 of the name gives the same, which the status query relies on.
 */
const indexOf = (collection: string): string => `rag_hnsw_${createHash("md5").update(collection).digest("hex").slice(0, 16)}`;

/** A collection name inside DDL, which takes no parameters; names are checked to [a-z0-9_-] before they get here. */
const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;

const indexSql = (collection: string, concurrently: boolean): string =>
  `CREATE INDEX ${concurrently ? "CONCURRENTLY " : ""}IF NOT EXISTS ${indexOf(collection)} ON rag_chunk USING hnsw (embedding vector_cosine_ops) WHERE collection = ${literal(collection)}`;

/** Whether an index exists and is usable: a concurrent build that failed leaves one marked invalid. */
const INDEX_STATE = "SELECT i.indisvalid AS valid FROM pg_class x JOIN pg_index i ON i.indexrelid = x.oid WHERE x.relname = $1";

/** `left(source, length(prefix)) = prefix`, not LIKE: a path may hold % and _. */
const PREFIX = "($PREFIX::text IS NULL OR left(source, length($PREFIX::text)) = $PREFIX::text)";

type DocumentSql = { source: string; sha256: string; size: string; kind: string; pages: number | null; extraction: string; indexed: Date; chunks: string };

const documentOf = (r: DocumentSql): DocumentRow => ({
  source: r.source,
  sha256: r.sha256,
  size: Number(r.size),
  kind: r.kind,
  pages: r.pages ?? undefined,
  extraction: r.extraction,
  chunks: Number(r.chunks),
  indexed: r.indexed.toISOString(),
});

const COLLECTION_COLUMNS = "c.name, c.description, c.model, c.dimension, c.created, c.provider, c.provider_model, c.provider_probe, c.spent_tokens, c.spent_neurons";

type CollectionSql = {
  name: string;
  description: string;
  model: string;
  dimension: number;
  created: Date;
  provider: string;
  provider_model: string;
  provider_probe: ProbeResult | null;
  spent_tokens: string;
  spent_neurons: number;
};

const collectionOf = (r: CollectionSql): CollectionInfo => ({
  name: r.name,
  description: r.description,
  model: r.model,
  dimension: r.dimension,
  created: r.created.toISOString(),
  provider: r.provider === "cloudflare" ? "cloudflare" : "local",
  // Collections made before providers were recorded: the local model is what embedded them.
  provider_model: r.provider_model === "" ? r.model : r.provider_model,
  ...(r.provider_probe === null ? {} : { provider_probe: r.provider_probe }),
  spent_tokens: Number(r.spent_tokens),
  spent_neurons: Number(r.spent_neurons),
});

const DOCUMENT_COLUMNS = `d.source, d.sha256, d.size, d.kind, d.pages, d.extraction, d.indexed,
  (SELECT count(*) FROM rag_chunk k WHERE k.collection = d.collection AND k.source = d.source) AS chunks`;

type ChunkSql = { collection: string; source: string; id: string; ordinal: number; location: string; body: string };

/** How long the full-text half of a search may take before it is left out. */
const MATCH_TIMEOUT_MS = 5000;

/** New chunks per INSERT: one statement for a whole long document would carry hundreds of MB of vectors as one parameter. */
const INSERT_BATCH = 256;

export const makeStore = (pool: () => Promise<Pool>): Store => {
  let ensured: number | undefined;
  let upgraded = false;
  const tablesExist = async (db: Pool): Promise<boolean> => (await query<{ t: string | null }>(db, "SELECT to_regclass('rag_collection')::text AS t")).rows[0]?.t != null;
  /** Whether the tables exist, bringing their columns up to this version first (once per process). */
  const ready = async (db: Pool): Promise<boolean> => {
    if (!(await tablesExist(db))) return false;
    if (upgraded) return true;
    await inTransaction(db, async (client) => {
      await query(client, "SELECT pg_advisory_xact_lock(hashtext('rag_schema'))");
      for (const statement of UPGRADES) await query(client, statement);
    });
    upgraded = true;
    return true;
  };

  return {
    status: async () => {
      const db = await pool();
      const ext = await query<{ extname: string; extversion: string }>(db, "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'unaccent')");
      const version = (name: string) => ext.rows.find((r) => r.extname === name)?.extversion;
      if (!(await tablesExist(db))) return { vector: version("vector"), unaccent: version("unaccent"), dimension: undefined, collections: 0, unindexed: [] };
      const meta = await query<{ value: string }>(db, "SELECT value FROM rag_meta WHERE key = 'dimension'");
      const names = await query<{ name: string; indexed: boolean }>(
        db,
        `SELECT c.name, EXISTS (SELECT 1 FROM pg_class x JOIN pg_index i ON i.indexrelid = x.oid
                               WHERE x.relname = 'rag_hnsw_' || left(md5(c.name), 16) AND i.indisvalid) AS indexed
         FROM rag_collection c ORDER BY c.name`,
      );
      return {
        vector: version("vector"),
        unaccent: version("unaccent"),
        dimension: meta.rows[0] ? Number(meta.rows[0].value) : undefined,
        collections: names.rows.length,
        unindexed: names.rows.filter((r) => !r.indexed).map((r) => r.name),
      };
    },

    ensureSchema: async (dimension) => {
      if (ensured === dimension) return;
      const db = await pool();
      if (!Number.isInteger(dimension) || dimension < 1 || dimension > 2000) return fail({ kind: "input", message: `an HNSW index takes 1 to 2000 dimensions, not ${dimension}` });
      await inTransaction(db, async (client) => {
        // One process at a time creates the tables; a second waits and then finds them.
        await query(client, "SELECT pg_advisory_xact_lock(hashtext('rag_schema'))");
        for (const statement of schemaSql(dimension)) await query(client, statement);
      });
      const stored = await query<{ value: string }>(db, "SELECT value FROM rag_meta WHERE key = 'dimension'");
      const existing = Number(stored.rows[0]?.value);
      if (existing !== dimension)
        return fail({ kind: "mismatch", message: `the tables were made for ${existing}-dimension vectors and the embed endpoint makes ${dimension}; an index for another model needs its own database` });
      ensured = dimension;
    },

    collections: async () => {
      const db = await pool();
      if (!(await ready(db))) return [];
      const rows = await query<CollectionSql & { documents: string; chunks: string }>(
        db,
        `SELECT ${COLLECTION_COLUMNS},
           (SELECT count(*) FROM rag_document d WHERE d.collection = c.name) AS documents,
           (SELECT count(*) FROM rag_chunk k WHERE k.collection = c.name) AS chunks
         FROM rag_collection c ORDER BY c.name`,
      );
      return rows.rows.map((r): CollectionRow => ({ ...collectionOf(r), documents: Number(r.documents), chunks: Number(r.chunks) }));
    },

    collectionInfos: async () => {
      const db = await pool();
      if (!(await ready(db))) return [];
      const rows = await query<CollectionSql>(db, `SELECT ${COLLECTION_COLUMNS} FROM rag_collection c ORDER BY c.name`);
      return rows.rows.map(collectionOf);
    },

    createCollection: async (row) =>
      inTransaction(await pool(), async (client) => {
        const out = await query(
          client,
          `INSERT INTO rag_collection (name, description, model, dimension, provider, provider_model, provider_probe)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (name) DO NOTHING`,
          [row.name, row.description, row.model, row.dimension, row.provider, row.provider_model, row.provider_probe === undefined ? null : JSON.stringify(row.provider_probe)],
        );
        // Empty, so made at once; a leftover of a dropped namesake would hold none of its rows either.
        if ((out.rowCount ?? 0) > 0) await query(client, indexSql(row.name, false));
        return (out.rowCount ?? 0) > 0;
      }),

    ensureIndex: async (name) => {
      const db = await pool();
      const state = await query<{ valid: boolean }>(db, INDEX_STATE, [indexOf(name)]);
      let built = false;
      if (state.rows[0]?.valid !== true) {
        // Concurrently: searches and indexing go on meanwhile. A failed build leaves an invalid index, which is dropped first.
        if (state.rows[0] !== undefined) await query(db, `DROP INDEX CONCURRENTLY IF EXISTS ${indexOf(name)}`);
        await query(db, indexSql(name, true));
        built = true;
      }
      const left = await query<{ n: string }>(
        db,
        `SELECT count(*) AS n FROM rag_collection c WHERE NOT EXISTS (SELECT 1 FROM pg_class x JOIN pg_index i ON i.indexrelid = x.oid
           WHERE x.relname = 'rag_hnsw_' || left(md5(c.name), 16) AND i.indisvalid)`,
      );
      if (Number(left.rows[0]?.n ?? 0) === 0) await query(db, `DROP INDEX CONCURRENTLY IF EXISTS ${SHARED_INDEX}`);
      return built;
    },

    setProvider: async (name, setting) => {
      const out = await query(await pool(), "UPDATE rag_collection SET provider = $2, provider_model = $3, provider_probe = $4::jsonb WHERE name = $1", [
        name,
        setting.provider,
        setting.provider_model,
        setting.provider_probe === undefined ? null : JSON.stringify(setting.provider_probe),
      ]);
      return (out.rowCount ?? 0) > 0;
    },

    addSpent: async (name, usage) => {
      if (usage.tokens === 0 && usage.neurons === 0) return;
      await query(await pool(), "UPDATE rag_collection SET spent_tokens = spent_tokens + $2, spent_neurons = spent_neurons + $3 WHERE name = $1", [name, usage.tokens, usage.neurons]);
    },

    dropCollection: async (name) =>
      inTransaction(await pool(), async (client) => {
        const counts = await query<{ documents: string; chunks: string }>(
          client,
          `SELECT (SELECT count(*) FROM rag_document WHERE collection = $1) AS documents,
                  (SELECT count(*) FROM rag_chunk WHERE collection = $1) AS chunks`,
          [name],
        );
        const gone = await query(client, "DELETE FROM rag_collection WHERE name = $1", [name]);
        if ((gone.rowCount ?? 0) === 0) return undefined;
        await query(client, `DROP INDEX IF EXISTS ${indexOf(name)}`);
        return { documents: Number(counts.rows[0]?.documents ?? 0), chunks: Number(counts.rows[0]?.chunks ?? 0) };
      }),

    document: async (collection, source) => {
      const r = await query<DocumentSql>(await pool(), `SELECT ${DOCUMENT_COLUMNS} FROM rag_document d WHERE d.collection = $1 AND d.source = $2`, [collection, source]);
      return r.rows[0] === undefined ? undefined : documentOf(r.rows[0]);
    },

    chunkIds: async (collection, source) => {
      const r = await query<{ id: string }>(await pool(), "SELECT id FROM rag_chunk WHERE collection = $1 AND source = $2", [collection, source]);
      return new Set(r.rows.map((x) => x.id));
    },

    saveDocument: async (collection, document, chunks) =>
      inTransaction(await pool(), async (client): Promise<SaveResult> => {
        await query(client, "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [collection, document.source]);
        // The chunks to keep were read before this lock; another call may have removed them since.
        const keep = chunks.filter((c) => c.embedding === undefined).map((c) => c.id);
        const present = await query<{ id: string }>(client, "SELECT id FROM rag_chunk WHERE collection = $1 AND source = $2 AND id = ANY($3::text[])", [
          collection,
          document.source,
          keep,
        ]);
        if (present.rows.length < new Set(keep).size) {
          const there = new Set(present.rows.map((r) => r.id));
          return { saved: false, missing: keep.filter((id) => !there.has(id)) };
        }
        await query(
          client,
          `INSERT INTO rag_document (collection, source, sha256, size, kind, pages, extraction, indexed) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (collection, source) DO UPDATE SET sha256 = $3, size = $4, kind = $5, pages = $6, extraction = $7, indexed = now()`,
          [collection, document.source, document.sha256, document.size, document.kind, document.pages ?? null, document.extraction],
        );
        const ids = chunks.map((c) => c.id);
        const removed = await query(client, "DELETE FROM rag_chunk WHERE collection = $1 AND source = $2 AND NOT (id = ANY($3::text[]))", [collection, document.source, ids]);
        await query(
          client,
          `UPDATE rag_chunk c SET ordinal = u.ordinal FROM unnest($2::text[], $3::int[]) AS u(id, ordinal)
           WHERE c.collection = $1 AND c.id = u.id AND c.ordinal <> u.ordinal`,
          [collection, ids, chunks.map((c) => c.ordinal)],
        );
        const fresh = chunks.filter((c): c is ChunkToStore & { embedding: readonly number[] } => c.embedding !== undefined);
        let added = 0;
        for (let i = 0; i < fresh.length; i += INSERT_BATCH) {
          const batch = fresh.slice(i, i + INSERT_BATCH);
          const inserted = await query(
            client,
            `INSERT INTO rag_chunk (collection, source, id, ordinal, location, body, embedding, fts)
             SELECT $1, $2, u.id, u.ordinal, u.location, u.body, u.embedding::vector, to_tsvector('simple', unaccent(u.body))
             FROM unnest($3::text[], $4::int[], $5::text[], $6::text[], $7::text[]) AS u(id, ordinal, location, body, embedding)
             ON CONFLICT (collection, id) DO NOTHING`,
            [collection, document.source, batch.map((c) => c.id), batch.map((c) => c.ordinal), batch.map((c) => c.location), batch.map((c) => c.body), batch.map((c) => vectorText(c.embedding))],
          );
          added += inserted.rowCount ?? 0;
        }
        return { saved: true, added, kept: keep.length, removed: removed.rowCount ?? 0 };
      }),

    removeSources: async (collection, path) => {
      const r = await query(await pool(), "DELETE FROM rag_document WHERE collection = $1 AND (source = $2 OR left(source, length($2) + 1) = $2 || '/')", [collection, path]);
      return r.rowCount ?? 0;
    },

    prune: async (collection, folder, { present, recursive }) => {
      // The part of the path below the folder, from its leading slash: '/.' in it means a dot-named part.
      const r = await query(
        await pool(),
        `DELETE FROM rag_document WHERE collection = $1 AND left(source, length($2) + 1) = $2 || '/'
           AND NOT (source = ANY($3::text[]))
           AND position('/.' in substr(source, length($2) + 1)) = 0
           AND ($4 OR position('/' in substr(source, length($2) + 2)) = 0)`,
        [collection, folder, [...present], recursive],
      );
      return r.rowCount ?? 0;
    },

    documents: async (collection, { prefix, limit, offset }) => {
      const db = await pool();
      const where = `d.collection = $1 AND ${PREFIX.replaceAll("$PREFIX", "$2").replaceAll("source", "d.source")}`;
      const total = await query<{ n: string }>(db, `SELECT count(*) AS n FROM rag_document d WHERE ${where}`, [collection, prefix ?? null]);
      const rows = await query<DocumentSql>(db, `SELECT ${DOCUMENT_COLUMNS} FROM rag_document d WHERE ${where} ORDER BY d.source LIMIT $3 OFFSET $4`, [collection, prefix ?? null, limit, offset]);
      return { total: Number(total.rows[0]?.n ?? 0), rows: rows.rows.map(documentOf) };
    },

    nearest: async (scope, embedding, limit) =>
      inTransaction(await pool(), async (client) => {
        // A source filter applied after an HNSW scan can leave fewer rows than asked;
        // pgvector 0.8's iterative scan keeps reading the index until the limit is met.
        await query(client, "SET LOCAL hnsw.ef_search = 100");
        await query(client, "SET LOCAL hnsw.iterative_scan = relaxed_order");
        // One collection per query, so the planner proves its partial index applies; their cosines compare, as one model embedded them all.
        const hits: Hit[] = [];
        for (const collection of scope.collections) {
          const r = await query<{ collection: string; id: string; value: number }>(
            client,
            `SELECT collection, id, 1 - (embedding <=> $1::vector) AS value FROM rag_chunk
             WHERE collection = $2 AND ${PREFIX.replaceAll("$PREFIX", "$3")}
             ORDER BY embedding <=> $1::vector LIMIT $4`,
            [vectorText(embedding), collection, scope.sourcePrefix ?? null, limit],
          );
          hits.push(...r.rows.map((x): Hit => ({ collection: x.collection, id: x.id, value: Number(x.value) })));
        }
        // relaxed_order may return neighbours slightly out of order: sort them again.
        return hits.sort((a, b) => b.value - a.value).slice(0, limit);
      }),

    matching: async (scope: SearchScope, text, limit) =>
      inTransaction(await pool(), async (client) => {
        // The full-text half is bounded: a question whose every word is frequent still matches most of a
        // large collection, and ranking every match took 50 s over 105,882 chunks. Past the bound the
        // query is cancelled (SQLSTATE 57014) and search goes on with the vector half.
        await query(client, `SET LOCAL statement_timeout = ${MATCH_TIMEOUT_MS}`);
        // ANY word of the query (OR), accents removed on both sides, words of one or two letters and the
        // stop words of Postgres's english and romanian configurations left out ("the", "when": they match
        // nearly every passage and rank nothing):
        // a question rarely shares all its words with the passage that answers it.
        const r = await query<{ collection: string; id: string; value: number }>(
          client,
          `WITH q AS (
             SELECT to_tsquery('simple', string_agg(quote_literal(t.lexeme), ' | ')) AS tsq
             FROM unnest(to_tsvector('simple', unaccent($1))) AS t
             WHERE length(t.lexeme) > 2
               AND to_tsvector('english', t.lexeme) <> ''::tsvector
               AND to_tsvector('romanian', t.lexeme) <> ''::tsvector)
           SELECT c.collection, c.id, ts_rank(c.fts, q.tsq) AS value
           FROM rag_chunk c, q
           WHERE q.tsq IS NOT NULL AND c.fts @@ q.tsq AND c.collection = ANY($2::text[]) AND ${PREFIX.replaceAll("$PREFIX", "$3").replaceAll("source", "c.source")}
           ORDER BY value DESC, c.id LIMIT $4`,
          [text, scope.collections, scope.sourcePrefix ?? null, limit],
        );
        return r.rows.map((x) => ({ collection: x.collection, id: x.id, value: Number(x.value) }));
      }),

    chunks: async (keys) => {
      if (keys.length === 0) return [];
      const r = await query<ChunkSql>(
        await pool(),
        `SELECT c.collection, c.source, c.id, c.ordinal, c.location, c.body
         FROM rag_chunk c JOIN unnest($1::text[], $2::text[]) AS k(collection, id) ON c.collection = k.collection AND c.id = k.id`,
        [keys.map((k) => k.collection), keys.map((k) => k.id)],
      );
      return r.rows.map((x): StoredChunk => x);
    },

    range: async (collection, source, from, to) => {
      const r = await query<ChunkSql>(
        await pool(),
        "SELECT collection, source, id, ordinal, location, body FROM rag_chunk WHERE collection = $1 AND source = $2 AND ordinal BETWEEN $3 AND $4 ORDER BY ordinal",
        [collection, source, from, to],
      );
      return r.rows;
    },
  };
};
