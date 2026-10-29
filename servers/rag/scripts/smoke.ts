/**
 * Live smoke test: drives the built server as a real MCP client would.
 *
 *   npm run build -w @foreverworks/mcp-rag
 *   RAG_DATABASE_URL=... RAG_EMBED_URL=... RAG_RERANK_URL=... npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health and list_collections only, unless SMOKE_DIR names a folder the server
 * may read: then it WRITES, creating a collection named smoke-<time>, indexing
 * that folder, searching it for SMOKE_QUERY, and dropping the collection
 * again (drop_collection asks for confirmation where the client does).
 */
import { connectSmoke, getDefaultEnvironment, toolJson } from "@foreverworks/mcp-kit";

const ragEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => (entry[0].startsWith("RAG_") || entry[0] === "MCP_FILE_ROOTS") && entry[1] !== undefined),
);

const show = (label: string, value: unknown, max = 1500): void => console.log(`\n${label}:`, JSON.stringify(value).slice(0, max));

const main = async (): Promise<void> => {
  const client = await connectSmoke({ env: { ...getDefaultEnvironment(), ...ragEnv } });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const health = await call("health");
  show("health", health);
  show("list_collections", await call("list_collections"));
  const dir = process.env["SMOKE_DIR"];
  if (dir !== undefined && health.ok === true) {
    const name = `smoke-${Date.now()}`;
    show("create_collection", await call("create_collection", { name, description: "smoke test, dropped at the end" }));
    let t = Date.now();
    show(`index_path (${Date.now() - t} ms)`, await call("index_path", { collection: name, path: dir }), 3000);
    t = Date.now();
    show(`search (${Date.now() - t} ms)`, await call("search", { query: process.env["SMOKE_QUERY"] ?? "What is this about?", collections: [name], limit: 3 }), 3000);
    show("drop_collection", await call("drop_collection", { name }));
  }
  await client.close();
  if (health.ok !== true) process.exit(1);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
