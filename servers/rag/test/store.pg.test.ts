/**
 * The Postgres store against a real Postgres with pgvector: opt-in, skipped unless RAG_TEST_DATABASE_URL names
 * a server to test on. It makes a database of its own on that server (so the role needs CREATEDB and the
 * right to create the vector extension: the postgres user of the pgvector image has both), runs the checks in
 * it and drops it, leaving the server as it found it.
 *
 *   docker run -d --rm --name rag-test-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 pgvector/pgvector:0.8.7-pg17
 *   RAG_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/postgres npm test -w @foreverworks/mcp-rag
 */
import { randomBytes } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { similar } from "../src/app/usecases/similar.js";
import { asAppError, remedyFor } from "../src/domain/errors.js";
import { makePool, poolConfigOf } from "../src/infra/database.js";
import { makeStore, SIMILAR_SQL } from "../src/infra/store.js";
import { memoryStore } from "./memoryStore.js";
import { fillSimilar, similarCases, similarSources } from "./similarSuite.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** RAG_TEST_DATABASE_URL as the shell had it; empty when unset (vitest.config.ts). */
    ragTestDatabaseUrl: string;
  }
}

const adminUrl = inject("ragTestDatabaseUrl");
const NAMES = { docs: "docs", elsewhere: "elsewhere", long: "long", near: "near" } as const;

describe.skipIf(adminUrl === "")("the Postgres store", () => {
  const database = `rag_test_${randomBytes(6).toString("hex")}`;
  const url = (() => {
    if (adminUrl === "") return "";
    const u = new URL(adminUrl);
    u.pathname = `/${database}`;
    return u.href;
  })();
  const pool = makePool({ RAG_DATABASE_URL: url });
  let ready: ReturnType<typeof makeStore> | undefined;
  const store = () => ready ?? (ready = makeStore(pool));

  beforeAll(async () => {
    const admin = new pg.Pool(poolConfigOf(adminUrl, undefined));
    try {
      await admin.query(`CREATE DATABASE ${database}`);
    } finally {
      await admin.end();
    }
    await fillSimilar(store(), NAMES);
  }, 60_000);

  afterAll(async () => {
    if (ready !== undefined) await (await pool()).end();
    const admin = new pg.Pool(poolConfigOf(adminUrl, undefined));
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  similarCases(async () => ({ store: store(), names: NAMES }));

  it("gives the answers the in-memory store gives for the same documents, every document as the source", async () => {
    const memory = memoryStore();
    await fillSimilar(memory, NAMES);
    for (const { collection, source, candidates } of similarSources()) {
      for (const k of candidates) {
        const args = { collection: NAMES[collection], source, limit: 50, minScore: 0, candidates: k };
        expect(await similar({ store: store() }, args), `${source} with ${k} candidates`).toEqual(await similar({ store: memory }, args));
      }
    }
  });

  it("cancels a comparison that runs past its time limit, with an error that says what to try", async () => {
    // Another session holds the table, so the comparison waits for it until the database cancels the statement.
    const holder = await (await pool()).connect();
    try {
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE rag_chunk IN ACCESS EXCLUSIVE MODE");
      const slow = makeStore(pool, { similarTimeoutMs: 300 });
      const error = await slow.similar({ collection: NAMES.docs, source: "/data/notes/pricing.md", candidates: 10, sample: 64 }).then(
        () => undefined,
        (thrown: unknown) => asAppError(thrown),
      );
      expect(error).toMatchObject({ kind: "database", code: "57014" });
      expect(error?.message).toContain("0.3 s");
      expect(error?.message).toContain("smaller candidates");
      expect(error === undefined ? "" : remedyFor(error)).toContain("smaller candidates");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    // The connection the cancelled call used went back to the pool in working order.
    expect((await similar({ store: store() }, { collection: NAMES.docs, source: "/data/notes/pricing.md", limit: 1, minScore: 0, candidates: 10 })).results).toHaveLength(1);
  });

  it("probes the collection's own HNSW index once per compared chunk, not a scan of the table", async () => {
    const client = await (await pool()).connect();
    try {
      // A table of a few rows is read in full by any plan; with scans off, the plan shows what the query could use.
      await client.query("SET enable_seqscan = off");
      await client.query("SET enable_bitmapscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN (COSTS OFF) ${SIMILAR_SQL}`, [NAMES.docs, "/data/notes/pricing.md", 10, 64]);
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(text).toMatch(/Index Scan using rag_hnsw_[0-9a-f]{16} on rag_chunk/u);
    } finally {
      client.release();
    }
  });
});
