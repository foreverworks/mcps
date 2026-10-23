import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bundleManifest, cursorLink, installBlock, keywordsOf, readManifest, readWorkspaces, serverJson, taglineProblems, vscodeLink, type Manifest } from "../packaging.js";

const MCP = { title: "Example", audience: "general", maturity: "beta", tagline: "Read and file the records of an example service." };

/** A repository with one server, `example`, whose package.json is `pkg` over the usual fields. */
const repo = (pkg: Readonly<Record<string, unknown>>): string => {
  const root = mkdtempSync(join(tmpdir(), "packaging-"));
  mkdirSync(join(root, "servers", "example"), { recursive: true });
  const base = {
    name: "@foreverworks/mcp-example",
    version: "1.2.3",
    description: "MCP server for an example service: its records, and the details after the colon",
    mcpName: "com.foreverworks/example",
    mcp: { ...MCP, inputs: {} },
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
  it("is the package's name, version, title and tagline", () => {
    const entry = serverJson(manifestOf({}));
    expect(entry).toMatchObject({
      name: "com.foreverworks/example",
      title: "Example",
      description: "Read and file the records of an example service.",
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
    const [npm] = serverJson(manifestOf({ mcp: { ...MCP, inputs } }))["packages"] as readonly { readonly environmentVariables: unknown }[];
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
    expect(problemsOf({ mcp: { ...MCP, inputs: { EXAMPLE_API_KEY: { title: "Key", type: "text", required: true, description: "The key." } } } })).toEqual([
      expect.stringContaining("EXAMPLE_API_KEY looks like a secret typed as text"),
    ]);
  });

  it("is refused without a title, an audience, a maturity, a tagline or inputs", () => {
    expect(problemsOf({ mcp: {} })).toEqual([
      expect.stringContaining("mcp.title"),
      expect.stringContaining("mcp.audience is null"),
      expect.stringContaining("mcp.maturity is null"),
      expect.stringContaining("mcp.tagline"),
      expect.stringContaining("mcp.inputs"),
    ]);
  });

  it("is refused with an audience or a maturity it does not know", () => {
    expect(problemsOf({ mcp: { ...MCP, audience: "worldwide", maturity: "alpha", inputs: {} } })).toEqual([
      expect.stringContaining('mcp.audience is "worldwide"; it must be one of romania, general, extras'),
      expect.stringContaining('mcp.maturity is "alpha"; it must be one of stable, beta, experimental'),
    ]);
  });

  it("is refused with a field nothing reads, such as the groups the README had before audiences", () => {
    expect(problemsOf({ mcp: { ...MCP, group: "Workspace", inputs: {} } })).toEqual([expect.stringContaining("mcp.group, which nothing reads")]);
  });
});

describe("a tagline", () => {
  it("is one plain sentence the registry can show whole", () => {
    expect(taglineProblems("Look up the National Bank of Romania's rate for any day, and convert amounts to and from RON.")).toEqual([]);
    expect(taglineProblems(`Read ${"records and more records ".repeat(5)}from it.`)).toEqual([expect.stringContaining("the registry takes 100")]);
    expect(taglineProblems("read the records")).toEqual([expect.stringContaining("a capital letter first, a full stop last")]);
    expect(taglineProblems("Read the records. Then file them.")).toEqual([expect.stringContaining("one sentence")]);
    expect(taglineProblems("Read the records \u2014 all of them.")).toEqual([expect.stringContaining("dash")]);
    expect(taglineProblems("A powerful way to read the records.")).toEqual([expect.stringContaining('"powerful"')]);
    expect(taglineProblems("An MCP server for the records.")).toEqual([expect.stringContaining("MCP server")]);
  });
});

describe("a server's keywords", () => {
  it("are the base ones, its audience's, then its own, whatever audience it had before", () => {
    expect(keywordsOf("romania", ["oblio", "mcp", "invoicing"])).toEqual(["mcp", "model-context-protocol", "mcp-server", "romania", "romanian", "oblio", "invoicing"]);
    expect(keywordsOf("general", ["mcp", "romania", "romanian", "oblio"])).toEqual(["mcp", "model-context-protocol", "mcp-server", "oblio"]);
  });
});

describe("what ships", () => {
  /** A repository of workspaces: each server's audience and dependencies, each package's dependencies. */
  const workspacesOf = (servers: Readonly<Record<string, { readonly audience: string; readonly deps: readonly string[] }>>, packages: Readonly<Record<string, readonly string[]>>) => {
    const root = mkdtempSync(join(tmpdir(), "workspaces-"));
    const write = (dir: string, pkg: Readonly<Record<string, unknown>>): void => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ version: "1.0.0", private: true, ...pkg }));
    };
    const deps = (names: readonly string[]) => Object.fromEntries(names.map((n) => [`@foreverworks/${n}`, "^1.0.0"]));
    for (const [name, p] of Object.entries(packages)) write(`packages/${name}`, { name: `@foreverworks/${name}`, dependencies: deps(p) });
    for (const [name, s] of Object.entries(servers)) write(`servers/${name}`, { name: `@foreverworks/mcp-${name}`, mcp: { audience: s.audience }, dependencies: deps(s.deps) });
    return readWorkspaces(root);
  };

  it("follows from a server's audience, and a package ships only when something that ships needs it", () => {
    const { workspaces, problems } = workspacesOf(
      { rates: { audience: "romania", deps: ["mcp-kit"] }, notes: { audience: "general", deps: ["mcp-kit"] }, orders: { audience: "extras", deps: ["mcp-kit", "receipts"] } },
      { "mcp-kit": [], receipts: ["mcp-kit"] },
    );
    expect(problems).toEqual([]);
    expect(Object.fromEntries(workspaces.map((w) => [w.dir, w.ships]))).toEqual({
      "packages/mcp-kit": true,
      "packages/receipts": false,
      "servers/notes": true,
      "servers/orders": false,
      "servers/rates": true,
    });
  });

  it("is unknown for a server without a known audience, which is a problem", () => {
    const { workspaces, problems } = workspacesOf({ odd: { audience: "somewhere", deps: ["mcp-kit"] } }, { "mcp-kit": [] });
    expect(problems).toEqual([expect.stringContaining("servers/odd: package.json's mcp.audience must be one of")]);
    expect(workspaces.map((w) => w.ships)).toEqual([false, false]);
  });
});

describe("installing a server", () => {
  const m = (): Manifest => manifestOf({ mcp: { ...MCP, inputs } });
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

  it("for an extras server offers only the clone, and says why there is no package", () => {
    const block = installBlock(manifestOf({ private: true, mcp: { ...MCP, audience: "extras", inputs } }));
    expect(block).toContain("Example is one of this repository's [extras](../../README.md#extras)");
    expect(block).toContain("which are not published to npm, the MCP Registry or as desktop bundles");
    expect(block).toContain('claude mcp add example -e EXAMPLE_CONFIG="<path to Example app.json>" -- node "$PWD/servers/example/dist/index.js"');
    expect(block).toContain('"args": ["<path to the clone>/servers/example/dist/index.js"]');
    expect(block).not.toMatch(/npx|vscode\.dev|cursor\.com|\.mcpb/);
  });
});

describe("a desktop bundle", () => {
  it("says what the server does in its tagline, and in full in its description", () => {
    expect(bundleManifest(manifestOf({}), [])).toMatchObject({
      description: "Read and file the records of an example service.",
      long_description: "MCP server for an example service: its records, and the details after the colon",
      keywords: ["mcp"],
    });
  });
});
