import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readManifest, type Manifest } from "../packaging.js";
import { listedOf, pluginFiles, submissionProblems, type File, type Source } from "../plugins.js";
import { claudeMarketplace, claudeMcp, claudePlugin, cursorMarketplace, cursorMcp, cursorPlugin, marketplaceOf } from "../plugins/manifests.js";
import { pluginReadme, wordsOf } from "../plugins/readme.js";

const MCP = { title: "Example", audience: "general", maturity: "beta", tagline: "Read and file the records of an example service." };

const INPUTS = {
  EXAMPLE_CONFIG: { title: "Example app.json", type: "file", required: true, description: "Path of app.json." },
  EXAMPLE_TOKEN: { title: "API token", type: "secret", required: false, description: "The API token." },
  EXAMPLE_TIME_ZONE: { title: "Time zone", type: "text", required: false, description: "The time zone." },
};

/** A server `example` whose package.json is `pkg` over the usual fields. */
const manifestOf = (pkg: Readonly<Record<string, unknown>> = {}): Manifest => {
  const root = mkdtempSync(join(tmpdir(), "plugins-"));
  mkdirSync(join(root, "servers", "example"), { recursive: true });
  const base = {
    name: "@foreverworks/mcp-example",
    version: "1.2.3",
    description: "MCP server for an example service: read its records and file new ones",
    mcpName: "com.foreverworks/example",
    mcp: { ...MCP, inputs: INPUTS },
    keywords: ["mcp", "example"],
    license: "MIT",
    author: "Forever Works",
    homepage: "https://foreverworks.github.io/mcps/servers/example/",
    bugs: "https://github.com/foreverworks/mcps/issues",
    repository: { type: "git", url: "git+https://github.com/foreverworks/mcps.git", directory: "servers/example" },
    bin: { "mcp-example": "dist/index.js" },
    engines: { node: ">=22.19" },
  };
  writeFileSync(join(root, "servers", "example", "package.json"), JSON.stringify({ ...base, ...pkg }));
  const { manifest, problems } = readManifest(root, "example");
  expect(problems).toEqual([]);
  return manifest as Manifest;
};

const README = ["| Tool | Access | What it does |", "|---|---|---|", "| `list_records` | read | Lists them. |", "| `file_record` / `pay_fee` | **money** | Files one. |"].join("\n");

const MARKET = marketplaceOf("https://github.com/foreverworks/mcps", "MCP servers for example services", "Forever Works");

const source = (pkg: Readonly<Record<string, unknown>> = {}): Source => ({ manifest: manifestOf(pkg), readme: README, icon: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

describe("which servers get a plugin", () => {
  it("is every server that is published: an audience that ships, and no longer private", () => {
    expect(listedOf(manifestOf())).toBe(true);
    expect(listedOf(manifestOf({ private: true }))).toBe(false);
    expect(listedOf(manifestOf({ mcp: { ...MCP, audience: "extras", inputs: {} }, private: true, mcpName: undefined }))).toBe(false);
  });
});

describe("a plugin's manifests", () => {
  it("names the plugin after its publisher, and links the listing to the site, the issues and the privacy page", () => {
    expect(claudePlugin(manifestOf(), "Forever Works")).toMatchObject({
      name: "foreverworks-example",
      version: "1.2.3",
      description: MCP.tagline,
      author: { name: "Forever Works", url: "https://foreverworks.github.io/mcps/" },
      icon: "./assets/icon.png",
      documentationUrl: "https://foreverworks.github.io/mcps/servers/example/",
      supportUrl: "https://github.com/foreverworks/mcps/issues",
      privacyPolicyUrl: "https://foreverworks.github.io/mcps/privacy/",
      license: "MIT",
    });
  });

  it("asks for each input as a userConfig option, a secret as a sensitive one", () => {
    expect(claudePlugin(manifestOf(), "Forever Works")["userConfig"]).toEqual({
      example_config: { type: "file", title: "Example app.json", description: "Path of app.json.", required: true },
      example_token: { type: "string", title: "API token", description: "The API token.", required: false, sensitive: true },
      example_time_zone: { type: "string", title: "Time zone", description: "The time zone.", required: false },
    });
    expect(claudePlugin(manifestOf({ mcp: { ...MCP, inputs: {} } }), "Forever Works")).not.toHaveProperty("userConfig");
  });

  it("starts the package at its exact version, each input from its option", () => {
    expect(claudeMcp(manifestOf())).toEqual({
      mcpServers: {
        example: {
          command: "npx",
          args: ["-y", "@foreverworks/mcp-example@1.2.3"],
          env: { EXAMPLE_CONFIG: "${user_config.example_config}", EXAMPLE_TOKEN: "${user_config.example_token}", EXAMPLE_TIME_ZONE: "${user_config.example_time_zone}" },
        },
      },
    });
    expect(claudeMcp(manifestOf({ mcp: { ...MCP, inputs: {} } }))).toEqual({ mcpServers: { example: { command: "npx", args: ["-y", "@foreverworks/mcp-example@1.2.3"] } } });
  });

  it("gives Cursor a variable per input, an optional one empty by default, and the same command", () => {
    expect(cursorPlugin(manifestOf(), "Forever Works")).toMatchObject({
      name: "foreverworks-example",
      logo: "assets/icon.png",
      variables: {
        type: "object",
        properties: {
          EXAMPLE_CONFIG: { type: "string", title: "Example app.json", description: "Path of app.json." },
          EXAMPLE_TOKEN: { type: "string", default: "" },
          EXAMPLE_TIME_ZONE: { type: "string", default: "" },
        },
        required: ["EXAMPLE_CONFIG"],
      },
    });
    expect(cursorMcp(manifestOf())).toEqual({
      mcpServers: {
        example: {
          command: "npx",
          args: ["-y", "@foreverworks/mcp-example@1.2.3"],
          env: { EXAMPLE_CONFIG: "${EXAMPLE_CONFIG}", EXAMPLE_TOKEN: "${EXAMPLE_TOKEN}", EXAMPLE_TIME_ZONE: "${EXAMPLE_TIME_ZONE}" },
        },
      },
    });
  });
});

describe("the marketplaces", () => {
  it("are named after the repository and list each plugin by its folder", () => {
    expect(MARKET).toMatchObject({ slug: "foreverworks/mcps", name: "foreverworks-mcps" });
    expect(claudeMarketplace(MARKET, [manifestOf()])).toEqual({
      name: "foreverworks-mcps",
      owner: { name: "Forever Works", url: "https://foreverworks.github.io/mcps/" },
      description: "MCP servers for example services",
      plugins: [{ name: "foreverworks-example", source: "./plugins/example", description: MCP.tagline, version: "1.2.3" }],
    });
    expect(cursorMarketplace(MARKET, [manifestOf()])).toEqual({
      name: "foreverworks-mcps",
      owner: { name: "Forever Works" },
      metadata: { description: "MCP servers for example services", pluginRoot: "plugins" },
      plugins: [{ name: "foreverworks-example", source: "example" }],
    });
  });
});

describe("a plugin's README", () => {
  const readme = pluginReadme(manifestOf(), README, MARKET);

  it("says what the server does, what it can change, how to install it and what each setting is", () => {
    expect(readme).toMatch(/^# Example plugin from Forever Works\n\nRead and file the records of an example service\. Read its records and file new ones\.\n/);
    expect(readme).toContain("It has 3 tools, and 2 of them are **money**");
    expect(readme).toContain("`file_record` and `pay_fee`");
    expect(readme).toContain("/plugin install foreverworks-example --marketplace foreverworks/mcps");
    expect(readme).toContain("| Example app.json (`EXAMPLE_CONFIG`) | yes | Path of app.json. |");
    expect(readme).toContain("`npx -y @foreverworks/mcp-example@1.2.3`");
    expect(readme).toContain("https://foreverworks.github.io/mcps/privacy/");
  });

  it("is written in the house style, and long enough for Claude's directory", () => {
    expect(readme).not.toMatch(/[—–]/);
    expect(wordsOf(readme)).toBeGreaterThanOrEqual(40);
  });

  it("says a read-only server only reads", () => {
    expect(pluginReadme(manifestOf(), "| `list_records` | read | Lists them. |", MARKET)).toContain("It has 1 tool, and it only reads.");
  });
});

describe("what Claude's directory would block", () => {
  const files = pluginFiles([source()], "MIT License", { url: "https://github.com/foreverworks/mcps", description: "MCP servers" });

  it("finds nothing in the plugins this writes", () => {
    expect(submissionProblems(files, [source()])).toEqual([]);
    expect(files.map((f) => f.path)).toEqual([
      "plugins/example/.claude-plugin/plugin.json",
      "plugins/example/.mcp.json",
      "plugins/example/.cursor-plugin/plugin.json",
      "plugins/example/mcp.json",
      "plugins/example/README.md",
      "plugins/example/LICENSE",
      "plugins/example/assets/icon.png",
      ".claude-plugin/marketplace.json",
      ".cursor-plugin/marketplace.json",
    ]);
  });

  it("finds a short README, a large file, a package-manager configuration and an unpinned package", () => {
    const bad: readonly File[] = [
      { path: "plugins/example/README.md", content: "Too short." },
      { path: "plugins/example/notes.txt", content: "x".repeat(256 * 1024) },
      { path: "plugins/example/.npmrc", content: "registry=https://registry.example.com/" },
      { path: "plugins/example/assets/icon.png", content: Buffer.alloc(300 * 1024) },
    ];
    const problems = submissionProblems(bad, [source({ version: "latest" })]);
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/README\.md has 2 words/);
    expect(problems.join("\n")).toMatch(/notes\.txt is 256 KiB/);
    expect(problems.join("\n")).toMatch(/\.npmrc sets a package source/);
    expect(problems.join("\n")).toMatch(/not an exact version/);
  });
});
