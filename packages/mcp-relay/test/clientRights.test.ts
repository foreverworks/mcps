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

  it("still lets the client held to read run a tool that reads, when the call names no file", async () => {
    const alice = await as("alice");
    try {
      const echoed = await alice.callTool({ name: "echo", arguments: { path: "/not/a/file/of/the/inbox" } });
      expect(jsonOf(echoed)).toMatchObject({ path: "/not/a/file/of/the/inbox" });
      expect(audited("echo")).toMatchObject([{ client: "alice", outcome: "ok" }]);
    } finally {
      await alice.close();
    }
  });

  it("does not carry a file for the client held to read: the call is not made, the error says why, and nothing reaches the server", async () => {
    const alice = await as("alice");
    const bob = await as("bob");
    try {
      const path = join(world.localIn, "alice-scan.txt");
      await writeFile(path, "pages of alice");
      const before = audited("read_input").length;
      const failure = await alice.callTool({ name: "read_input", arguments: { path } }).then(
        () => undefined,
        (error: unknown) => error as { message: string },
      );
      expect(failure?.message).toContain(path);
      expect(failure?.message).toContain("the upstream does not carry files for alice (403)");
      expect(failure?.message).toContain("a ceiling (MCP_CLIENT_MAX_ACCESS on the server)");
      expect(failure?.message).toContain("for clients with no ceiling");
      // Not the words for a refused token, which would send a person to the wrong file.
      expect(failure?.message).not.toContain("refused the relay's token");
      expect(failure?.message).not.toContain(world.clients["alice"]?.upstreamToken as string);
      expect(await exists(join(world.remoteIn, "alice-scan.txt"))).toBe(false);
      expect(audited("read_input")).toHaveLength(before);

      // The other client, with no ceiling, sends the very same kind of file and its call runs.
      const free = join(world.localIn, "bob-scan.txt");
      await writeFile(free, "pages of bob");
      expect(jsonOf(await bob.callTool({ name: "read_input", arguments: { path: free } }))).toMatchObject({ text: "pages of bob" });
      expect(audited("read_input")).toMatchObject([{ client: "bob", outcome: "ok" }]);
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("does not bring a file out of the server's outbox for the client held to read, whoever made it, and says why", async () => {
    const alice = await as("alice");
    const bob = await as("bob");
    try {
      await writeFile(join(world.remoteOut, "made-for-bob.txt"), "output of another client's call");
      const uri = `file://${join(world.localOut, "made-for-bob.txt")}`;
      const refused = (await alice.callTool({ name: "link_to", arguments: { uris: [uri] } })) as { content: { text?: string }[] };
      const note = refused.content.at(-1)?.text as string;
      expect(note).toContain("made-for-bob.txt");
      expect(note).toContain("the upstream does not carry files for alice (403)");
      expect(note).not.toContain("refused the relay's token");
      expect(note).not.toContain("output of another client's call");
      expect(await exists(join(world.localOut, "made-for-bob.txt"))).toBe(false);

      const fetched = (await bob.callTool({ name: "link_to", arguments: { uris: [uri] } })) as { content: { text?: string }[] };
      expect(fetched.content).toHaveLength(2);
      expect(await readFile(join(world.localOut, "made-for-bob.txt"), "utf8")).toBe("output of another client's call");
    } finally {
      await alice.close();
      await bob.close();
    }
  });

  it("does not put the server's tokens in the relay's log", () => {
    const tokens = Object.values(world.clients).flatMap((held) => [held.upstreamToken, held.relayToken]);
    for (const token of tokens) expect(world.relayLog.join("\n")).not.toContain(token);
    expect(world.relayLog.find((line) => line.startsWith("relay: listening"))).toContain("for alice, bob;");
  });
});

/** A relay with one token for the server, which is held to read: every client of the relay is. */
describe("a relay whose one upstream token is held to a ceiling", () => {
  it("says that the client has no files, in words that do not point at the token file", async () => {
    const world = await startWorld({ serverEnv: { MCP_CLIENT_MAX_ACCESS: "relay=read" } });
    try {
      const client = await connectTo(world);
      const path = join(world.localIn, "scan.txt");
      await writeFile(path, "pages");
      const failure = await client.callTool({ name: "read_input", arguments: { path } }).then(
        () => undefined,
        (error: unknown) => error as { message: string },
      );
      expect(failure?.message).toContain("the upstream does not carry files for this client (403)");
      expect(failure?.message).toContain("MCP_CLIENT_MAX_ACCESS");
      expect(failure?.message).not.toContain("MCP_RELAY_UPSTREAM_TOKEN_FILE");
      expect(failure?.message).not.toContain(world.upstreamToken);
      await client.close();
    } finally {
      await world.close();
    }
  });
});
