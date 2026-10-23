/**
 * The tool surface as a client sees it, snapshotted: every tool's name, title,
 * description and input schema, in the order tools/list returns them. Sessions
 * call these tools by name and argument, so a diff in tools.snapshot.json is a
 * breaking change and has to be a deliberate one.
 */
import { McpServer, connectInMemory } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { registerAll } from "../src/mcp/register.js";
import { tokensDir } from "./helpers.js";

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const server = new McpServer({ name: "notion", version: "test" });
    // A fixed file root: without one the description names the working directory, which differs per checkout.
    registerAll(server, buildDeps({ NOTION_TOKENS_DIR: tokensDir({}), MCP_FILE_ROOTS: "/srv/notion-inbox" }));
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });
});
