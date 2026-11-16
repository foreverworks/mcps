import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectTo, jsonOf, startWorld, type World } from "./harness.js";

/**
 * What per-client tokens are for: the server holds each client to its own
 * rights, and the relay carries a client's calls under that client's name, so
 * a client that may only read stays so through the relay. The server here is
 * the kit's own, with its policy and its guard; alice's ceiling is `read`.
 */
describe("clients the server tells apart, through the relay", () => {
  let world: World;
  beforeAll(async () => {
    world = await startWorld({ clients: ["alice", "bob"], serverEnv: { MCP_CLIENT_MAX_ACCESS: "alice=read" } });
  });
  afterAll(() => world.close());

  const as = (name: "alice" | "bob") => connectTo({ relayUrl: world.relayUrl, relayToken: world.clients[name]?.relayToken as string });
  const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);
  const audited = (tool: string): { client: string; outcome: string }[] =>
    world.upstreamAudit.filter((line) => line.startsWith("audit ")).map((line) => JSON.parse(line.slice("audit ".length)) as { tool: string; client: string; outcome: string }).filter((line) => line.tool === tool);

  it("refuses the client held to read a tool that writes, and runs it for the other", async () => {
    const alice = await as("alice");
    const bob = await as("bob");
    try {
      const held = await alice.callTool({ name: "save_report", arguments: { name: "held.txt", text: "from alice" } });
      expect(jsonOf(held)).toMatchObject({ error: { kind: "access_denied", access: "write", allowed: "read", client: "alice", remedy: expect.stringContaining("MCP_CLIENT_MAX_ACCESS") } });
      expect(await exists(join(world.remoteOut, "held.txt"))).toBe(false);
      expect(await exists(join(world.localOut, "held.txt"))).toBe(false);

      const free = await bob.callTool({ name: "save_report", arguments: { name: "free.txt", text: "from bob" } });
      expect(jsonOf(free)).toMatchObject({ saved: "free.txt" });
      expect(await readFile(join(world.localOut, "free.txt"), "utf8")).toBe("from bob");

      // The server saw two clients, by the names of their tokens, and held each to its own rights.
      expect(audited("save_report")).toMatchObject([
        { client: "alice", outcome: "access_denied" },
        { client: "bob", outcome: "ok" },
      ]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("still lets the client held to read run a tool that reads, with the file it names", async () => {
    const alice = await as("alice");
    try {
      const path = join(world.localIn, "alice-scan.txt");
      await writeFile(path, "pages of alice");
      const read = await alice.callTool({ name: "read_input", arguments: { path } });
      expect(jsonOf(read)).toMatchObject({ text: "pages of alice" });
      expect(audited("read_input")).toMatchObject([{ client: "alice", outcome: "ok" }]);
    } finally {
      await alice.close();
    }
  });

  it("does not put the server's tokens in the relay's log", () => {
    const tokens = Object.values(world.clients).flatMap((held) => [held.upstreamToken, held.relayToken]);
    for (const token of tokens) expect(world.relayLog.join("\n")).not.toContain(token);
    expect(world.relayLog.find((line) => line.startsWith("relay: listening"))).toContain("for alice, bob;");
  });
});
