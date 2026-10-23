/**
 * The tool surface as a client sees it, snapshotted: every tool's name, title,
 * description and input schema, in the order tools/list returns them, through
 * the guard. Sessions call these tools by name and argument, so a diff in
 * tools.snapshot.json is a breaking change and has to be a deliberate one.
 */
import { connectInMemory, guard, McpServer } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { policyFor } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { stateDir } from "./helpers.js";

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const { deps } = buildDeps({ ANAF_SPV_STATE_DIR: stateDir(), MCP_FILE_ROOTS: "/srv/inbox" });
    const server = new McpServer({ name: "anaf-spv", version: "test" });
    registerAll(guard(server, { service: "anaf-spv", policy: policyFor(deps), log: () => undefined }), deps);
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });
});
