import type pg from "pg";

import type { ChunkToStore, CollectionRow, DocumentRow, Hit, SearchScope, Store, StoredChunk } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import type { Pool } from "./database.js";

/**
 * The index in Postgres with pgvector: collections, the documents in each
 * (one per source path, with the sha256 that makes a re-run incremental) and
 * their chunks, each with its embedding (HNSW, cosine) and a full-text vector
 * with accents removed (GIN). Every name is prefixed rag_ so the tables can
 * share a database.
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
     indexed timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, source))`,
  `CREATE TABLE IF NOT EXISTS rag_chunk (
     collection text NOT NULL, source text NOT NULL, id text NOT NULL, ordinal integer NOT NULL,
     location text NOT NULL, body text NOT NULL, embedding vector(${dimension}) NOT NULL, fts tsvector NOT NULL,
     PRIMARY KEY (collection, id),
     FOREIGN KEY (collection, source) REFERENCES rag_document (collection, source) ON DELETE CASCADE)`,
  "CREATE INDEX IF NOT EXISTS rag_chunk_embedding ON rag_chunk USING hnsw (embedding vector_cosine_ops)",
  "CREATE INDEX IF NOT EXISTS rag_chunk_fts ON rag_chunk USING gin (fts)",
  "CREATE INDEX IF NOT EXISTS rag_chunk_document ON rag_chunk (collection, source, ordinal)",
];

/** `left(source, length(prefix)) = prefix`, not LIKE: a path may hold % and _. */
const PREFIX = "($PREFIX::text IS NULL OR left(source, length($PREFIX::text)) = $PREFIX::text)";

type DocumentSql = { source: string; sha256: string; size: string; kind: string; pages: number | null; indexed: Date; chunks: string };

const documentOf = (r: DocumentSql): DocumentRow => ({
  source: r.source,
  sha256: r.sha256,
  size: Number(r.size),
  kind: r.kind,
  pages: r.pages ?? undefined,
  chunks: Number(r.chunks),
  indexed: r.indexed.toISOString(),
});

const DOCUMENT_COLUMNS = `d.source, d.sha256, d.size, d.kind, d.pages, d.indexed,
  (SELECT count(*) FROM rag_chunk k WHERE k.collection = d.collection AND k.source = d.source) AS chunks`;

type ChunkSql = { collection: string; source: string; id: string; ordinal: number; location: string; body: string };

export const makeStore = (pool: () => Promise<Pool>): Store => {
  let ensured: number | undefined;
  const tablesExist = async (db: Pool): Promise<boolean> => (await query<{ t: string | null }>(db, "SELECT to_regclass('rag_collection')::text AS t")).rows[0]?.t != null;

  return {
    status: async () => {
      const db = await pool();
      const ext = await query<{ extname: string; extversion: string }>(db, "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'unaccent')");
      const version = (name: string) => ext.rows.find((r) => r.extname === name)?.extversion;
      if (!(await tablesExist(db))) return { vector: version("vector"), unaccent: version("unaccent"), dimension: undefined, collections: 0 };
      const meta = await query<{ value: string }>(db, "SELECT value FROM rag_meta WHERE key = 'dimension'");
      const count = await query<{ n: string }>(db, "SELECT count(*) AS n FROM rag_collection");
      return { vector: version("vector"), unaccent: version("unaccent"), dimension: meta.rows[0] ? Number(meta.rows[0].value) : undefined, collections: Number(count.rows[0]?.n ?? 0) };
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
      if (!(await tablesExist(db))) return [];
      const rows = await query<{ name: string; description: string; model: string; dimension: number; created: Date; documents: string; chunks: string }>(
        db,
        `SELECT c.name, c.description, c.model, c.dimension, c.created,
           (SELECT count(*) FROM rag_document d WHERE d.collection = c.name) AS documents,
           (SELECT count(*) FROM rag_chunk k WHERE k.collection = c.name) AS chunks
         FROM rag_collection c ORDER BY c.name`,
      );
      return rows.rows.map((r): CollectionRow => ({ ...r, created: r.created.toISOString(), documents: Number(r.documents), chunks: Number(r.chunks) }));
    },

    createCollection: async (row) => {
      const out = await query(await pool(), "INSERT INTO rag_collection (name, description, model, dimension) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING", [
        row.name,
        row.description,
        row.model,
        row.dimension,
      ]);
      return (out.rowCount ?? 0) > 0;
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
      inTransaction(await pool(), async (client) => {
        await query(client, "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [collection, document.source]);
        await query(
          client,
          `INSERT INTO rag_document (collection, source, sha256, size, kind, pages, indexed) VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (collection, source) DO UPDATE SET sha256 = $3, size = $4, kind = $5, pages = $6, indexed = now()`,
          [collection, document.source, document.sha256, document.size, document.kind, document.pages ?? null],
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
        const added = await query(
          client,
          `INSERT INTO rag_chunk (collection, source, id, ordinal, location, body, embedding, fts)
           SELECT $1, $2, u.id, u.ordinal, u.location, u.body, u.embedding::vector, to_tsvector('simple', unaccent(u.body))
           FROM unnest($3::text[], $4::int[], $5::text[], $6::text[], $7::text[]) AS u(id, ordinal, location, body, embedding)
           ON CONFLICT (collection, id) DO NOTHING`,
          [collection, document.source, fresh.map((c) => c.id), fresh.map((c) => c.ordinal), fresh.map((c) => c.location), fresh.map((c) => c.body), fresh.map((c) => vectorText(c.embedding))],
        );
        const addedCount = added.rowCount ?? 0;
        return { added: addedCount, kept: chunks.length - fresh.length, removed: removed.rowCount ?? 0 };
      }),

    removeSources: async (collection, path, except = new Set()) => {
      const r = await query(
        await pool(),
        `DELETE FROM rag_document WHERE collection = $1 AND (source = $2 OR left(source, length($2) + 1) = $2 || '/') AND NOT (source = ANY($3::text[]))`,
        [collection, path, [...except]],
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
        // A filter (collection, source) applied after an HNSW scan can leave fewer rows than asked;
        // pgvector 0.8's iterative scan keeps reading the index until the limit is met.
        await query(client, "SET LOCAL hnsw.ef_search = 100");
        await query(client, "SET LOCAL hnsw.iterative_scan = relaxed_order");
        const r = await query<{ collection: string; id: string; value: number }>(
          client,
          `SELECT collection, id, 1 - (embedding <=> $1::vector) AS value FROM rag_chunk
           WHERE collection = ANY($2::text[]) AND ${PREFIX.replaceAll("$PREFIX", "$3")}
           ORDER BY embedding <=> $1::vector LIMIT $4`,
          [vectorText(embedding), scope.collections, scope.sourcePrefix ?? null, limit],
        );
        // relaxed_order may return neighbours slightly out of order: sort them again.
        return r.rows.map((x): Hit => ({ collection: x.collection, id: x.id, value: Number(x.value) })).sort((a, b) => b.value - a.value);
      }),

    matching: async (scope: SearchScope, text, limit) => {
      // ANY word of the query (OR), accents removed on both sides, words of one or two letters left out:
      // a question rarely shares all its words with the passage that answers it.
      const r = await query<{ collection: string; id: string; value: number }>(
        await pool(),
        `WITH q AS (
           SELECT to_tsquery('simple', string_agg(quote_literal(t.lexeme), ' | ')) AS tsq
           FROM unnest(to_tsvector('simple', unaccent($1))) AS t
           WHERE length(t.lexeme) > 2)
         SELECT c.collection, c.id, ts_rank_cd(c.fts, q.tsq) AS value
         FROM rag_chunk c, q
         WHERE q.tsq IS NOT NULL AND c.fts @@ q.tsq AND c.collection = ANY($2::text[]) AND ${PREFIX.replaceAll("$PREFIX", "$3").replaceAll("source", "c.source")}
         ORDER BY value DESC, c.id LIMIT $4`,
        [text, scope.collections, scope.sourcePrefix ?? null, limit],
      );
      return r.rows.map((x) => ({ collection: x.collection, id: x.id, value: Number(x.value) }));
    },

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
