import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bundleManifest, cursorLink, installBlock, readManifest, serverJson, summaryOf, vscodeLink, type Manifest } from "../packaging.js";

/** A repository with one server, `example`, whose package.json is `pkg` over the usual fields. */
const repo = (pkg: Readonly<Record<string, unknown>>): string => {
  const root = mkdtempSync(join(tmpdir(), "packaging-"));
  mkdirSync(join(root, "servers", "example"), { recursive: true });
  const base = {
    name: "@foreverworks/mcp-example",
    version: "1.2.3",
    description: "MCP server for an example service: its records, and the details after the colon",
    mcpName: "com.foreverworks/example",
    mcp: { title: "Example", inputs: {} },
    keywords: ["mcp"],
    license: "MIT",
    author: "Forever Works",
    homepage: "https://github.com/foreverworks/mcps/tree/main/servers/example#readme",
    bugs: "https://github.com/foreverworks/mcps/issues",
    repository: { type: "git", url: "git+https://github.com/foreverworks/mcps.git", directory: "servers/example" },
    bin: { "mcp-example": "dist/index.js" },
    engines: { node: ">=22.19" },
  };
  writeFileSync(join(root, "servers", "example", "package.json"), JSON.stringify({ ...base, ...pkg }));
  return root;
};

const manifestOf = (pkg: Readonly<Record<string, unknown>>): Manifest => {
  const { manifest, problems } = readManifest(repo(pkg), "example");
  expect(problems).toEqual([]);
  return manifest as Manifest;
};

const inputs = {
  EXAMPLE_CONFIG: { title: "Example app.json", type: "file", required: true, description: "Path of app.json." },
  EXAMPLE_TOKEN: { title: "API token", type: "secret", required: false, description: "The API token." },
  EXAMPLE_TIME_ZONE: { title: "Time zone", type: "text", required: false, description: "The time zone." },
};

describe("a server's registry entry", () => {
  it("is the package's name, version, title and the head of its description", () => {
    const entry = serverJson(manifestOf({}));
    expect(entry).toMatchObject({
      name: "com.foreverworks/example",
      title: "Example",
      description: "MCP server for an example service",
      version: "1.2.3",
      repository: { url: "https://github.com/foreverworks/mcps", source: "github", subfolder: "servers/example" },
      icons: [
        { src: "https://raw.githubusercontent.com/foreverworks/mcps/main/servers/example/icons/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
        { src: "https://raw.githubusercontent.com/foreverworks/mcps/main/servers/example/icons/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
      ],
      packages: [{ registryType: "npm", identifier: "@foreverworks/mcp-example", version: "1.2.3", transport: { type: "stdio" } }],
    });
    expect(entry["packages"]).toEqual([expect.not.objectContaining({ environmentVariables: expect.anything() })]);
  });

  it("asks for a path as a file path and for a secret as a secret, never as plain text", () => {
    const [npm] = serverJson(manifestOf({ mcp: { title: "Example", inputs } }))["packages"] as readonly { readonly environmentVariables: unknown }[];
    expect(npm?.environmentVariables).toEqual([
      { name: "EXAMPLE_CONFIG", description: "Path of app.json.", isRequired: true, isSecret: false, format: "filepath" },
      { name: "EXAMPLE_TOKEN", description: "The API token.", isRequired: false, isSecret: true },
      { name: "EXAMPLE_TIME_ZONE", description: "The time zone.", isRequired: false, isSecret: false },
    ]);
  });
});

describe("a package.json that cannot make one", () => {
  const problemsOf = (pkg: Readonly<Record<string, unknown>>): readonly string[] => readManifest(repo(pkg), "example").problems;

  it("is refused when a secret is declared as plain text", () => {
    expect(problemsOf({ mcp: { title: "Example", inputs: { EXAMPLE_API_KEY: { title: "Key", type: "text", required: true, description: "The key." } } } })).toEqual([
      expect.stringContaining("EXAMPLE_API_KEY looks like a secret typed as text"),
    ]);
  });

  it("is refused when the description's head is longer than the registry takes", () => {
    expect(problemsOf({ description: `MCP server for ${"a very long name ".repeat(7)}: details` })).toEqual([expect.stringContaining("the registry takes 100")]);
  });

  it("is refused without a title or inputs", () => {
    expect(problemsOf({ mcp: {} })).toEqual([expect.stringContaining("mcp.title"), expect.stringContaining("mcp.inputs")]);
  });
});

describe("summaryOf", () => {
  it("is the description up to its first colon and space", () => {
    expect(summaryOf("MCP server for ANAF's SPV (pfinternet.anaf.ro): the documents")).toBe("MCP server for ANAF's SPV (pfinternet.anaf.ro)");
    expect(summaryOf("Read-only MCP server for receipts")).toBe("Read-only MCP server for receipts");
  });
});

describe("installing a server", () => {
  const m = (): Manifest => manifestOf({ mcp: { title: "Example", inputs } });
  const query = (link: string): URLSearchParams => new URL(link).searchParams;

  it("in VS Code runs the published package and asks for each input, a secret as a password", () => {
    const params = query(vscodeLink(m()));
    expect(params.get("name")).toBe("example");
    expect(JSON.parse(params.get("config") ?? "")).toEqual({
      command: "npx",
      args: ["-y", "@foreverworks/mcp-example"],
      env: { EXAMPLE_CONFIG: "${input:example_config}", EXAMPLE_TOKEN: "${input:example_token}", EXAMPLE_TIME_ZONE: "${input:example_time_zone}" },
    });
    expect(JSON.parse(params.get("inputs") ?? "")).toEqual([
      { type: "promptString", id: "example_config", description: "Path of app.json." },
      { type: "promptString", id: "example_token", description: "Optional. The API token.", password: true },
      { type: "promptString", id: "example_time_zone", description: "Optional. The time zone." },
    ]);
  });

  it("in Cursor reads every input from the environment, so nothing is written into its plain config", () => {
    const config = JSON.parse(Buffer.from(query(cursorLink(m())).get("config") ?? "", "base64").toString("utf8")) as { readonly env: Readonly<Record<string, string>> };
    expect(config.env).toEqual({ EXAMPLE_CONFIG: "${env:EXAMPLE_CONFIG}", EXAMPLE_TOKEN: "${env:EXAMPLE_TOKEN}", EXAMPLE_TIME_ZONE: "${env:EXAMPLE_TIME_ZONE}" });
  });

  it("as a desktop bundle asks for a path as a file and keeps a secret in a sensitive field", () => {
    const manifest = bundleManifest(m(), [{ name: "ping", description: "Answers." }]);
    expect(manifest).toMatchObject({
      manifest_version: "0.3",
      name: "mcp-example",
      display_name: "Example",
      icon: "icon.png",
      server: {
        type: "node",
        entry_point: "node_modules/@foreverworks/mcp-example/dist/index.js",
        mcp_config: {
          command: "node",
          args: ["${__dirname}/node_modules/@foreverworks/mcp-example/dist/index.js"],
          env: { EXAMPLE_CONFIG: "${user_config.example_config}", EXAMPLE_TOKEN: "${user_config.example_token}", EXAMPLE_TIME_ZONE: "${user_config.example_time_zone}" },
        },
      },
      user_config: {
        example_config: { type: "file", title: "Example app.json", description: "Path of app.json.", required: true },
        example_token: { type: "string", title: "API token", description: "The API token.", required: false, sensitive: true },
        example_time_zone: { type: "string", title: "Time zone", description: "The time zone.", required: false },
      },
      tools: [{ name: "ping", description: "Answers." }],
    });
    expect((manifest["user_config"] as Readonly<Record<string, object>>)["example_time_zone"]).not.toHaveProperty("sensitive");
  });

  it("says in the README what each client does with the settings", () => {
    expect(installBlock(manifestOf({}))).toContain("It needs no settings.");
    expect(installBlock(m())).toContain("Cursor reads each from your environment instead (`${env:EXAMPLE_CONFIG}` and so on)");
    expect(installBlock(m())).toContain("The commands above set only what is required; [Configuration](#configuration) has the rest.");
  });

  it("gives Claude Code and JSON clients the same command, with a placeholder for each required setting only", () => {
    const block = installBlock(m());
    expect(block).toContain('claude mcp add example -e EXAMPLE_CONFIG="<path to Example app.json>" -- npx -y @foreverworks/mcp-example');
    expect(block).toContain('"EXAMPLE_CONFIG": "<path to Example app.json>"');
    expect(block).not.toContain("EXAMPLE_TOKEN=");
    expect(block).toContain('-- node "$PWD/servers/example/dist/index.js"');
  });

  it("says a private package is not on npm before anyone presses a button", () => {
    expect(installBlock(manifestOf({ private: true }))).toContain("`@foreverworks/mcp-example` is not on npm yet");
    expect(installBlock(manifestOf({}))).not.toContain("not on npm yet");
  });
});
