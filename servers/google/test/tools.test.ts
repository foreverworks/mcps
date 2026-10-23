/**
 * The tool surface as a client sees it, snapshotted: every tool's name, title,
 * description and input schema, in the order tools/list returns them, through
 * the guard (so each tool carries its access class and hints). Sessions call
 * these tools by name and argument, so a diff in tools.snapshot.json is a
 * breaking change and has to be a deliberate one. The snapshot is the default
 * surface, every toolset loaded; test/toolsets.test.ts holds the subsets.
 */
import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildRegistries } from "../src/composition.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { FIXED_ENV } from "./fixedEnv.js";

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const server = new McpServer({ name: "google", version: "test" });
    registerAll(guard(server, { service: "google", policy: POLICY, log: () => undefined }), buildRegistries(FIXED_ENV));
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });
});
