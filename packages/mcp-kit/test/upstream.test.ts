import { describe, expect, it } from "vitest";
import { z } from "zod";

import { InMemoryTransport, McpServer, type Transport } from "../src/mcp.js";
import { atPath, connectUpstream, fillTemplate, type UpstreamEndpoint, type UpstreamTransportFor, usingUpstream } from "../src/upstream.js";

const ENDPOINT: UpstreamEndpoint = { kind: "stdio", command: "fake-vault", args: [], env: {} };
const IDENTITY = { name: "mcp-test", version: "1.0.0" };
const refuse = (message: string): never => {
  throw new Error(`upstream: ${message}`);
};
const messageOf = (p: Promise<unknown>): Promise<string> => p.then(() => "resolved", (e: unknown) => (e as Error).message);

const vault = (): McpServer => {
  const server = new McpServer({ name: "fake-vault", version: "0.0.0" });
  server.registerTool("get_item", { inputSchema: { id: z.string(), field: z.string().optional() } }, async ({ id }) =>
    id === "item-1"
      ? { content: [{ type: "text" as const, text: JSON.stringify({ login: { username: "ana@example.com", password: "pw-0001" } }) }] }
      : { content: [{ type: "text" as const, text: "no such item" }], isError: true },
  );
  return server;
};

const inMemory =
  (make: () => McpServer): UpstreamTransportFor =>
  async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await make().connect(serverSide as Transport);
    return clientSide as Transport;
  };

const connect = (transportFor: UpstreamTransportFor) => connectUpstream(ENDPOINT, { name: "vault", client: IDENTITY, fail: refuse, transportFor });

describe("connectUpstream", () => {
  it("calls a tool and hands back its text and its JSON, and lists the tools with their string properties", async () => {
    const answer = await usingUpstream(connect(inMemory(vault)), async (c) => {
      expect(await c.tools()).toEqual([{ name: "get_item", properties: ["id", "field"], required: ["id"], stringProperties: ["id", "field"] }]);
      return c.call("get_item", { id: "item-1" });
    });
    expect(atPath(answer.json, "login.password")).toBe("pw-0001");
    expect(answer.text).toContain("ana@example.com");
  });

  it("makes a tool that answers an error the server's failure, with the start of its text", async () => {
    expect(await messageOf(usingUpstream(connect(inMemory(vault)), (c) => c.call("get_item", { id: "item-2" })))).toBe("upstream: get_item answered an error: no such item");
  });

  it("names the upstream and where it is when it cannot be reached", async () => {
    const unreachable: UpstreamTransportFor = async () => {
      const [clientSide] = InMemoryTransport.createLinkedPair();
      await clientSide.close();
      return clientSide as Transport;
    };
    expect(await messageOf(connect(unreachable)())).toMatch(/^upstream: could not connect to the vault MCP server at fake-vault: /);
  });

  it("lets a failure of the server's own, thrown while making the transport, through as it is", async () => {
    const tagged = { kind: "config", message: "VAULT_TOKEN_FILE names a file that cannot be read" };
    const failing: UpstreamTransportFor = async () => {
      throw tagged;
    };
    await expect(connect(failing)()).rejects.toBe(tagged);
  });
});

describe("fillTemplate and atPath", () => {
  it("fills placeholders, keeping a whole-string placeholder's own value and leaving unknown ones", () => {
    expect(fillTemplate({ id: "{{item}}", q: "in:{{folder}} {{other}}", n: [1, "{{item}}"] }, { item: "item-1", folder: "inbox" })).toEqual({
      id: "item-1",
      q: "in:inbox {{other}}",
      n: [1, "item-1"],
    });
  });

  it("reads a dot path, and the whole value at `.`", () => {
    expect(atPath({ data: { login: { password: "pw" } } }, "data.login.password")).toBe("pw");
    expect(atPath({ a: 1 }, ".")).toEqual({ a: 1 });
    expect(atPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });
});
