/**
 * The tool surface as a client sees it, snapshotted: every tool's name, title,
 * description and input schema, in the order tools/list returns them, through
 * the guard. Sessions call these tools by name and argument, so a diff in
 * tools.snapshot.json is a breaking change and has to be a deliberate one.
 */
import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const server = new McpServer({ name: "app-stores", version: "test" });
    registerAll(guard(server, { service: "app-stores", policy: POLICY, log: () => undefined }), buildDeps({}));
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });
});
