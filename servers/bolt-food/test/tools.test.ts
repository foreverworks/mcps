/**
 * The tool surface as a client sees it, snapshotted: every tool's name, title,
 * description and input schema, in the order tools/list returns them. Clients
 * call these tools by name and argument, so a diff in tools.snapshot.json is a
 * breaking change and has to be a deliberate one.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, McpServer } from "@foreverworks/mcp-kit";
import { POLICY } from "@foreverworks/receipts/mcp";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { registerAll } from "../src/mcp/register.js";

/** Temp paths only, and a named zone, so the snapshot is the same on every machine. */
const deps = async () => {
  const dir = await mkdtemp(join(tmpdir(), "bolt-food-tools-"));
  return buildDeps({ BOLT_FOOD_CREDS: join(dir, "credentials.json"), BOLT_FOOD_STATE_DIR: join(dir, "state"), BOLT_FOOD_TIME_ZONE: "Europe/Bucharest" });
};

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot", async () => {
    const server = new McpServer({ name: "bolt-food", version: "test" });
    registerAll(server, await deps());
    const client = await connectInMemory(server);
    const { tools } = await client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
  });

  it("classifies every tool it registers, and nothing else", async () => {
    const d = await deps();
    expect(() => checkPolicy("bolt-food", (server) => registerAll(server, d), POLICY)).not.toThrow();
  });
});
