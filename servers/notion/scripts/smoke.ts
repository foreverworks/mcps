/**
 * Live smoke test: spawns the built server over stdio and drives it as a real
 * MCP client would. Needs the token files; everything in test/ needs none.
 *
 *   npm run build -w @foreverworks/mcp-notion
 *   NOTION_TOKENS_DIR=<dir> npx tsx scripts/smoke.ts [options]
 *
 * READ-ONLY BY DEFAULT: list_accounts, health, a search across the workspaces,
 * describe_database, query_database and count_rows on the first database found
 * (or --database), read_page on the first page found (or --page), and one
 * input failure that never reaches Notion.
 *
 *   --database <id|url>   the database to describe, query and count
 *   --page <id|url>       the page to read
 *   --write <id|url|label> WRITES under that page, in its workspace, or with a
 *                         workspace label (list_accounts) at its top level as
 *                         a private page: creates "mcps smoke" from Markdown,
 *                         reads it back, appends, edits, comments, trashes it,
 *                         restores it and trashes it again. It ends in
 *                         Notion's trash.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const show = (label: string, value: unknown, max = 500): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  (${name}: ${Date.now() - started} ms)`);
    return out;
  };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));
  show("list_accounts", await call("list_accounts"));

  const health = await call("health");
  show("\nhealth", health, 800);
  if (health.error || !health.allOk) {
    await client.close();
    process.exit(1);
  }

  const found = await call("search", { limit: 10 });
  show("\nsearch", found, 800);
  const hits: { kind: string; id: string; account: string }[] = found.hits ?? [];

  const db = option("--database") ?? hits.find((h) => h.kind === "database")?.id;
  if (db !== undefined) {
    const described = await call("describe_database", { database: db });
    show("\ndescribe_database", described, 800);
    show("query_database", await call("query_database", { database: db, limit: 3 }), 800);
    const columns: { name: string; type: string }[] = described.sources?.[0]?.columns ?? [];
    const by = columns.find((c) => c.type === "status" || c.type === "select")?.name;
    show("count_rows", await call("count_rows", { database: db, ...(by === undefined ? {} : { by }) }), 600);
    // The failure worth seeing shaped correctly, which never reaches Notion: a column that does not exist.
    show("\ninput failure", (await call("query_database", { database: db, where: [{ property: "No such column", op: "equals", value: "x" }] })).error, 400);
  }

  const page = option("--page") ?? hits.find((h) => h.kind === "page")?.id;
  if (page !== undefined) show("\nread_page", await call("read_page", { page }), 800);

  const parent = option("--write");
  if (parent !== undefined) {
    const where: { account?: string; parent?: string } = /^[a-z0-9][a-z0-9-]*$/.test(parent) ? { account: parent } : { parent };
    const made = await call("create_page", { ...where, title: "mcps smoke", markdown: "Written by mcps notion's smoke test; safe to delete.", icon: "🧪" });
    show("\ncreate_page", made);
    if (made.error === undefined) {
      show("read_page", await call("read_page", { page: made.id }));
      show("append_content", await call("append_content", { page: made.id, markdown: "- [ ] appended" }));
      show("edit_content", await call("edit_content", { page: made.id, edits: [{ old: "safe to delete", new: "safe to delete (edited)" }] }));
      show("read_page", (await call("read_page", { page: made.id })).markdown);
      show("add_comment", await call("add_comment", { page: made.id, markdown: "smoke comment" }));
      show("get_comments", await call("get_comments", { page: made.id }));
      show("trash_page", await call("trash_page", { page: made.id }));
      // Notion's API cannot restore a top-level page (a validation error), so the round trip is for a child page only.
      if (where.parent !== undefined) {
        show("restore_page", await call("restore_page", { page: made.id }));
        show("trash_page", await call("trash_page", { page: made.id }));
      }
    }
  }

  await client.close();
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
