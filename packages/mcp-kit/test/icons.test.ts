import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Transport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { packageIdentity, productIcons } from "../src/packageIdentity.js";
import { MCP_PATH, serve, type Served } from "../src/serve.js";
import { toolIconsOf } from "../src/serve/icons.js";

/** The smallest valid PNG, a 1x1 transparent pixel: the bytes are what matter, not the picture. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const DATA_URI = `data:image/png;base64,${PNG.toString("base64")}`;

/** A package as a server's dist/index.js sees it: package.json, icons/, and the entry one folder down. */
const fakePackage = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "mcp-kit-identity-"));
  await mkdir(join(root, "icons"));
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", homepage: "https://example.com/x", mcp: { title: "Example" } }));
  await writeFile(join(root, "icons", "icon-48.png"), PNG);
  await writeFile(join(root, "icons", "mail-32.png"), PNG);
  return pathToFileURL(join(root, "dist", "index.js")).href;
};

describe("a package's identity", () => {
  it("is its title, home page and icon, the icon inline as PNG", async () => {
    const entry = await fakePackage();
    expect(packageIdentity(entry)).toEqual({ title: "Example", websiteUrl: "https://example.com/x", icons: [{ src: DATA_URI, mimeType: "image/png" }] });
    expect(productIcons(entry, "mail")).toEqual([{ src: DATA_URI, mimeType: "image/png" }]);
  });

  it("fails to start without its icon, rather than serve a server with none", async () => {
    const entry = await fakePackage();
    expect(() => productIcons(entry, "calendar")).toThrow(/calendar-32\.png/);
  });
});

describe("products", () => {
  const policy = { send: { access: "write" }, read: { access: "read" }, ping: { access: "read" } } as const;

  it("refuses a product naming a tool the policy does not, and a tool in two products", () => {
    expect(() => toolIconsOf("t", policy, [{ icons: [], tools: { other: { access: "read" } } }])).toThrow(/other, which the policy does not/);
    expect(() => toolIconsOf("t", policy, [{ icons: [], tools: { send: policy.send } }, { icons: [], tools: { send: policy.send } }])).toThrow(/send is in two products/);
  });
});

describe("served icons", () => {
  const token = "test-token-0123456789";
  const register = (server: McpServer): void => {
    for (const name of ["send", "read", "ping"]) {
      server.registerTool(name, { description: name, inputSchema: {} }, async () => ({ content: [{ type: "text" as const, text: name }] }));
    }
  };
  let served: Served;
  let client: Client;

  beforeAll(async () => {
    const entry = await fakePackage();
    const dir = await mkdtemp(join(tmpdir(), "mcp-kit-icons-"));
    await writeFile(join(dir, "token"), token);
    const policy = { send: { access: "write" }, read: { access: "read" }, ping: { access: "read" } } as const;
    served = await serve({
      name: "test",
      version: "0.0.0",
      ...packageIdentity(entry),
      products: [{ icons: productIcons(entry, "mail"), tools: { send: policy.send, read: policy.read } }],
      register,
      policy,
      env: { MCP_HTTP_PORT: "0", MCP_HTTP_TOKEN_FILE: join(dir, "token") },
      log: () => undefined,
    });
    client = new Client({ name: "test-client", version: "0.0.0" });
    const url = new URL(`http://127.0.0.1:${served.port}${MCP_PATH}`);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }) as Transport);
  });

  afterAll(async () => {
    await client.close();
    await served.close();
  });

  it("announces the server's title, page and icon at initialize", () => {
    expect(client.getServerVersion()).toEqual({ name: "test", version: "0.0.0", title: "Example", websiteUrl: "https://example.com/x", icons: [{ src: DATA_URI, mimeType: "image/png" }] });
  });

  it("puts a product's icon on each of its tools, and none on the others", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.icons])).toEqual([
      ["ping", undefined],
      ["read", [{ src: DATA_URI, mimeType: "image/png" }]],
      ["send", [{ src: DATA_URI, mimeType: "image/png" }]],
    ]);
  });
});
