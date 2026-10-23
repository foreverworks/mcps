/**
 * The server as a client sees it, through the kit's guard, end to end against
 * a stubbed fetch: two token files in a temp dir, and a fake Notion that knows
 * the tracker only under the work token. What is checked here is the whole path,
 * from a tool's arguments to the JSON Notion receives.
 */
import { checkPolicy, connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { labelsIn } from "../src/infra/tokens.js";
import { instructionsFor } from "../src/mcp/instructions.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { database, dataSource, ID, json, notionError, row, tokensDir, withFetch } from "./helpers.js";

const connected = async (env: NodeJS.ProcessEnv) => {
  const server = new McpServer({ name: "notion", version: "test" });
  registerAll(guard(server, { service: "notion", policy: POLICY, log: () => undefined }), buildDeps(env, { sleep: async () => undefined }));
  const client = await connectInMemory(server);
  return client;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (result: unknown): any => JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "{}");

/** Notion as the two tokens see it: the personal workspace has nothing, the work one has the tracker. */
const fakeNotion = () =>
  withFetch((url, init) => {
    const token = (init?.headers as Record<string, string>)["Authorization"];
    if (token !== "Bearer ntn_work") return notionError(404, "object_not_found", "Could not find it.");
    const path = new URL(url).pathname.replace("/v1/", "");
    if (path === `pages/${ID.row}`) return json(row());
    if (path === `pages/${ID.row}/markdown`) return json({ object: "page_markdown", id: ID.row, markdown: "# Acme", truncated: false, unknown_block_ids: [] });
    if (path === `databases/${ID.database}`) return json(database());
    if (path === `data_sources/${ID.source}`) return json(dataSource());
    if (path === `data_sources/${ID.source}/query`) return json({ object: "list", results: [row()], next_cursor: null, has_more: false });
    if (path === "pages" && init?.method === "POST") return json(row({ id: ID.other }));
    return notionError(404, "object_not_found");
  });

const env = () => ({ NOTION_TOKENS_DIR: tokensDir({ personal: "ntn_personal", work: "ntn_work" }) });

describe("the notion server", () => {
  it("classifies every tool it registers, and none of them as money", async () => {
    expect(() => checkPolicy("notion", (s) => registerAll(s, buildDeps({})), POLICY)).not.toThrow();
    const { tools } = await (await connected(env())).listTools();
    expect(tools.filter((t) => t._meta?.["foreverworks.com/access"] === "money")).toEqual([]);
  });

  it("names the workspaces its token files name, and none it was not given", () => {
    const dir = tokensDir({ personal: "ntn_personal", work: "ntn_work", spare: "" });
    expect(labelsIn(dir)).toEqual(["personal", "work"]);
    expect(labelsIn(undefined)).toEqual([]);
    expect(labelsIn("/nonexistent/notion-tokens")).toEqual([]);
    expect(instructionsFor(labelsIn(dir))).toMatch(/^Notion workspaces "personal", "work", through one server/);
    expect(instructionsFor([])).toMatch(/^Notion workspaces, one per integration token, through one server/);
  });

  it("reads a page by URL from the workspace that has it", async () => {
    fakeNotion();
    const client = await connected(env());
    const out = parse(await client.callTool({ name: "read_page", arguments: { page: `https://www.notion.so/Acme-${ID.row.replace(/-/g, "")}` } }));
    expect(out).toMatchObject({ account: "work", title: "Acme", markdown: "# Acme", properties: { Status: "Not started" } });
  });

  it("sends a where Notion can read: typed by the schema, in Notion's grammar", async () => {
    const calls = fakeNotion();
    const client = await connected(env());
    const out = parse(
      await client.callTool({
        name: "query_database",
        arguments: {
          database: ID.database,
          where: [
            { property: "status", op: "equals", value: "not started" },
            { property: "Due", op: "on_or_after", value: "2026-09-01" },
          ],
          sort: [{ property: "Due", direction: "descending" }],
          properties: ["Status"],
        },
      }),
    );
    expect(out).toMatchObject({ account: "work", count: 1, rows: [{ id: ID.row, title: "Acme", properties: { Status: "Not started" } }] });
    const query = calls.find((c) => c.url.includes("/query"));
    expect(query?.url).toContain("filter_properties=title&filter_properties=st%3A1");
    expect(query?.body).toEqual({
      filter: { and: [{ property: "Status", status: { equals: "Not started" } }, { property: "Due", date: { on_or_after: "2026-09-01" } }] },
      sorts: [{ property: "Due", direction: "descending" }],
      page_size: 100,
      result_type: "page",
    });
  });

  it("creates a row with Notion's property grammar and a Markdown body", async () => {
    const calls = fakeNotion();
    const client = await connected(env());
    const out = parse(
      await client.callTool({
        name: "create_page",
        arguments: { parent: ID.database, title: "Globex", properties: { Tags: ["web"], Due: "2026-09-28" }, markdown: "## Why", icon: "🏢" },
      }),
    );
    expect(out).toMatchObject({ account: "work", id: ID.other });
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/pages"))?.body).toEqual({
      parent: { type: "data_source_id", data_source_id: ID.source },
      properties: {
        Tags: { multi_select: [{ name: "Web" }] },
        Due: { date: { start: "2026-09-28" } },
        Name: { title: [{ type: "text", text: { content: "Globex" } }] },
      },
      markdown: "## Why",
      icon: { type: "emoji", emoji: "🏢" },
    });
  });

  it("answers an id no workspace has as not_shared, with the remedy", async () => {
    fakeNotion();
    const out = parse(await (await connected(env())).callTool({ name: "read_page", arguments: { page: ID.other } }));
    expect(out.error).toMatchObject({ kind: "not_shared", accounts: ["personal", "work"] });
    expect(out.error.remedy).toContain("Connections");
  });

  it("answers a missing tokens directory as config, naming the variable", async () => {
    const out = parse(await (await connected({})).callTool({ name: "list_accounts", arguments: {} }));
    expect(out.error).toMatchObject({ kind: "config" });
    expect(out.error.message).toContain("NOTION_TOKENS_DIR");
  });
});
