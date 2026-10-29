import { egressFrom, hostAllowed, once, readSecret } from "@foreverworks/mcp-kit";
import pg from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

import { configError, fail } from "../domain/errors.js";

/**
 * The connection pool, made on the first call that needs it (once: a failure
 * is not cached), so the server starts and lists its tools with no database.
 * The URL may leave the password out; it then comes from
 * RAG_DATABASE_PASSWORD_FILE, a service's credentials directory.
 *
 * The kit's egress list covers fetch only, so a database host is checked
 * against it here, as the other servers that open their own sockets do.
 */
export type Pool = pg.Pool;

const SECRET = { file: "RAG_DATABASE_PASSWORD_FILE", value: "RAG_DATABASE_PASSWORD" } as const;

/**
 * The pool's settings: the URL taken apart here, then the password from the
 * file or variable. Not `{ connectionString, password }`: pg parses the
 * string over the other settings, and a URL with no password then sets it
 * to nothing (pg 8.23, measured: "client password must be a string").
 */
export const poolConfigOf = (url: string, password: string | undefined): pg.PoolConfig => ({
  ...parseIntoClientConfig(url),
  ...(password === undefined ? {} : { password }),
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "mcp-rag",
});

export const makePool = (env: NodeJS.ProcessEnv): (() => Promise<Pool>) =>
  once(async () => {
    const url = env["RAG_DATABASE_URL"]?.trim();
    if (!url) return fail(configError("RAG_DATABASE_URL is not set: a postgresql:// URL of a database with the vector extension", "RAG_DATABASE_URL"));
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^\[|\]$/gu, "") || "localhost";
    } catch {
      return fail(configError("RAG_DATABASE_URL is not a URL", "RAG_DATABASE_URL"));
    }
    const allowed = egressFrom(env);
    if (allowed !== undefined && !hostAllowed(host, allowed)) return fail(configError(`the database host ${host} is not in MCP_EGRESS_ALLOW`, "MCP_EGRESS_ALLOW"));
    const password = await readSecret(env, SECRET, (message) => fail(configError(message, SECRET.file)));
    const pool = new pg.Pool(poolConfigOf(url, password));
    // An idle client whose server went away emits here; without a listener that would end the process.
    pool.on("error", (error) => console.error("rag: idle database connection failed:", error.message));
    return pool;
  });
