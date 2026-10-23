/**
 * What a server says about itself to installers, derived from its package.json,
 * the one place a server says what it is: its registry entry (`server.json`,
 * for the official MCP Registry), its desktop bundle's manifest (`.mcpb`) and
 * the install links in its README. check-docs writes and checks them, the
 * release builds and publishes them; nothing here is typed twice.
 *
 * A server's package.json carries, beside the npm fields:
 *
 *   "mcpName": "com.foreverworks/<server>",       the registry name; npm proves it is ours
 *   "mcp": {
 *     "title": "Oblio",                            a person's name for it
 *     "inputs": {                                  what a person sets to install it
 *       "OBLIO_CONFIG": { "title": "Oblio app.json", "type": "file", "required": true, "description": "Path of app.json ..." }
 *     }
 *   }
 *
 * An input's `type` is `file` or `directory` (a path: a credential lives in a
 * file, docs/configuration.md), `text` (a plain value such as a time zone) or
 * `secret` (a value that is itself a secret, for a server with no file
 * variable for it). A secret is never put in a plain field: the registry
 * entry marks it isSecret, a bundle marks it sensitive, a VS Code link asks
 * for it as a password, and a Cursor link, whose configuration is a plain
 * file, leaves it for the person to fill in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The registry's server.json schema these entries follow. */
export const SERVER_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

/** The registry namespace, proven by a DNS record on foreverworks.com (docs/releasing.md). */
export const NAMESPACE = "com.foreverworks";

/** The npm scope every server is published under, as `mcp-<server>`. */
const SCOPE = "@foreverworks/";

/** The registry's limit on a description, which is the head of the package's. */
export const SUMMARY_MAX = 100;

export const INPUT_TYPES = ["file", "directory", "text", "secret"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export type Input = {
  readonly name: string;
  /** Its label in a desktop bundle's settings. */
  readonly title: string;
  readonly type: InputType;
  readonly required: boolean;
  readonly description: string;
};

export type Manifest = {
  /** The folder under servers/. */
  readonly server: string;
  /** The npm name, `@foreverworks/mcp-<server>`. */
  readonly name: string;
  readonly version: string;
  readonly mcpName: string;
  readonly title: string;
  /** The package description: what it serves, then its details after a colon. */
  readonly description: string;
  /** The description's head, before its first colon: one line for a registry. */
  readonly summary: string;
  readonly homepage: string;
  /** Where to report a problem (package.json `bugs`). */
  readonly bugs: string;
  readonly repository: { readonly url: string; readonly directory: string };
  readonly license: string;
  readonly author: string;
  readonly keywords: readonly string[];
  readonly node: string;
  readonly bin: string;
  readonly inputs: readonly Input[];
  /** package.json `private`: the release does not publish it yet, so its README says so. */
  readonly private: boolean;
};

type PackageJson = {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly mcpName?: unknown;
  readonly mcp?: unknown;
  readonly homepage?: unknown;
  readonly bugs?: unknown;
  readonly repository?: unknown;
  readonly license?: unknown;
  readonly author?: unknown;
  readonly keywords?: unknown;
  readonly engines?: unknown;
  readonly bin?: unknown;
  readonly private?: unknown;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The registry name a server's package must carry. */
export const mcpNameOf = (server: string): string => `${NAMESPACE}/${server}`;

/** The head of a description: up to its first colon, or all of it. */
export const summaryOf = (description: string): string => {
  const colon = description.indexOf(": ");
  return (colon === -1 ? description : description.slice(0, colon)).trim();
};

/**
 * A server's manifest, or the problems that keep its package.json from making
 * one. `mcpName` is checked by the caller, which can write it.
 */
export const readManifest = (root: string, server: string): { readonly manifest?: Manifest; readonly problems: readonly string[] } => {
  const pkg = JSON.parse(readFileSync(join(root, "servers", server, "package.json"), "utf8")) as PackageJson;
  const problems: string[] = [];
  const text = (value: unknown, what: string): string => {
    if (typeof value === "string" && value.trim() !== "") return value;
    problems.push(`package.json has no ${what}`);
    return "";
  };
  const name = text(pkg.name, "name");
  if (name !== `${SCOPE}mcp-${server}`) problems.push(`package.json name is ${name}; a server's is ${SCOPE}mcp-${server}`);
  const description = text(pkg.description, "description");
  const summary = summaryOf(description);
  if (summary.length > SUMMARY_MAX) {
    problems.push(`the description's head (before its first ": ") is ${summary.length} characters; the registry takes ${SUMMARY_MAX}: say what it serves first, then the details after a colon`);
  }
  const mcp = isRecord(pkg.mcp) ? pkg.mcp : undefined;
  if (mcp === undefined) problems.push(`package.json has no "mcp" block (scripts/packaging.ts says what goes in it)`);
  const title = text(mcp?.["title"], `mcp.title`);
  const inputs: Input[] = [];
  const declared = mcp?.["inputs"];
  if (!isRecord(declared)) problems.push(`package.json has no mcp.inputs (an empty {} for a server that needs none)`);
  else {
    for (const [variable, spec] of Object.entries(declared)) {
      const type = isRecord(spec) ? spec["type"] : undefined;
      const required = isRecord(spec) ? spec["required"] : undefined;
      const said = isRecord(spec) ? spec["description"] : undefined;
      const label = isRecord(spec) ? spec["title"] : undefined;
      if (typeof label !== "string" || label.trim() === "") problems.push(`mcp.inputs.${variable} has no title (its label in a bundle's settings)`);
      if (!/^[A-Z][A-Z0-9_]*$/.test(variable)) problems.push(`mcp.inputs names "${variable}", which is not an environment variable`);
      if (!INPUT_TYPES.includes(type as InputType)) problems.push(`mcp.inputs.${variable}.type must be one of ${INPUT_TYPES.join(", ")}`);
      if (typeof required !== "boolean") problems.push(`mcp.inputs.${variable}.required must be true or false`);
      if (typeof said !== "string" || said.trim() === "") problems.push(`mcp.inputs.${variable} has no description`);
      if (type === "text" && /(TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)$/.test(variable)) {
        problems.push(`mcp.inputs.${variable} looks like a secret typed as text: make it a "file" (its _FILE twin) or a "secret"`);
      }
      inputs.push({
        name: variable,
        title: typeof label === "string" ? label.trim() : "",
        type: type as InputType,
        required: required === true,
        description: typeof said === "string" ? said.trim() : "",
      });
    }
  }
  const repository = isRecord(pkg.repository) ? pkg.repository : undefined;
  const url = text(repository?.["url"], "repository.url")
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
  const directory = text(repository?.["directory"], "repository.directory");
  const engines = isRecord(pkg.engines) ? pkg.engines : undefined;
  const bins = isRecord(pkg.bin) ? Object.values(pkg.bin) : [];
  const bin = typeof bins[0] === "string" ? bins[0] : "";
  if (bins.length !== 1 || bin === "") problems.push("package.json must name exactly one bin");
  const manifest: Manifest = {
    server,
    name,
    version: text(pkg.version, "version"),
    mcpName: typeof pkg.mcpName === "string" ? pkg.mcpName : "",
    title,
    description,
    summary,
    homepage: text(pkg.homepage, "homepage"),
    bugs: text(pkg.bugs, "bugs"),
    repository: { url, directory },
    license: text(pkg.license, "license"),
    author: text(pkg.author, "author"),
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords.filter((k): k is string => typeof k === "string") : [],
    node: text(engines?.["node"], "engines.node"),
    bin,
    inputs,
    private: pkg.private === true,
  };
  return problems.length === 0 ? { manifest, problems } : { problems };
};

/** One environment variable in a registry entry. */
type RegistryVariable = {
  readonly name: string;
  readonly description: string;
  readonly isRequired: boolean;
  readonly isSecret: boolean;
  readonly format?: "filepath";
};

const registryVariable = (input: Input): RegistryVariable => ({
  name: input.name,
  description: input.description,
  isRequired: input.required,
  isSecret: input.type === "secret",
  ...(input.type === "file" || input.type === "directory" ? { format: "filepath" as const } : {}),
});

/**
 * Where the registry finds a server's icon: the repository's own file on its
 * default branch. The registry takes only HTTPS links (no data: URI, at most
 * 255 characters); the files are scripts/icons.ts's.
 */
export const iconUrl = (m: Manifest, file: string): string =>
  `${m.repository.url.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${m.repository.directory}/icons/${file}`;

/** The server's entry in the official MCP Registry. */
export const serverJson = (m: Manifest): Readonly<Record<string, unknown>> => ({
  $schema: SERVER_SCHEMA,
  name: m.mcpName,
  title: m.title,
  description: m.summary,
  version: m.version,
  websiteUrl: m.homepage,
  repository: { url: m.repository.url, source: "github", subfolder: m.repository.directory },
  icons: [
    { src: iconUrl(m, "icon.svg"), mimeType: "image/svg+xml", sizes: ["any"] },
    { src: iconUrl(m, "icon-512.png"), mimeType: "image/png", sizes: ["512x512"] },
  ],
  packages: [
    {
      registryType: "npm",
      registryBaseUrl: "https://registry.npmjs.org",
      identifier: m.name,
      version: m.version,
      runtimeHint: "npx",
      transport: { type: "stdio" },
      ...(m.inputs.length > 0 ? { environmentVariables: m.inputs.map(registryVariable) } : {}),
    },
  ],
});

/** JSON as the repository writes it: two spaces, a final newline. */
export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A variable's id in an installer's prompt or a bundle's user_config: its name in lower case. */
const keyOf = (input: Input): string => input.name.toLowerCase();

/** What a prompt says about an input: its sentence, and that it may stay empty. */
const promptOf = (input: Input): string => (input.required ? input.description : `Optional. ${input.description}`);

/** How an installer starts the published package. */
export const npxCommand = (m: Manifest): { readonly command: string; readonly args: readonly string[] } => ({ command: "npx", args: ["-y", m.name] });

const enc = encodeURIComponent;

/**
 * VS Code's install link (vscode.dev redirects it to the editor): VS Code asks
 * for each input as it adds the server, a secret as a password it keeps in
 * its secret storage, and passes each as `${input:<id>}`.
 */
export const vscodeLink = (m: Manifest): string => {
  const inputs = m.inputs.map((i) => ({ type: "promptString", id: keyOf(i), description: promptOf(i), ...(i.type === "secret" ? { password: true } : {}) }));
  const config = { ...npxCommand(m), ...(m.inputs.length === 0 ? {} : { env: Object.fromEntries(m.inputs.map((i) => [i.name, `\${input:${keyOf(i)}}`])) }) };
  return `https://vscode.dev/redirect/mcp/install?name=${enc(m.server)}${inputs.length === 0 ? "" : `&inputs=${enc(JSON.stringify(inputs))}`}&config=${enc(JSON.stringify(config))}`;
};

/**
 * Cursor's install link. Cursor writes the configuration to a plain file and
 * has no prompts, so every input is read from the environment (`${env:NAME}`,
 * which Cursor resolves in `env`): nothing secret lands in the file, and no
 * made-up placeholder looks like a real value.
 */
export const cursorLink = (m: Manifest): string => {
  const config = { ...npxCommand(m), ...(m.inputs.length === 0 ? {} : { env: Object.fromEntries(m.inputs.map((i) => [i.name, `\${env:${i.name}}`])) }) };
  return `https://cursor.com/install-mcp?name=${enc(m.server)}&config=${enc(Buffer.from(JSON.stringify(config)).toString("base64"))}`;
};

/** Where the newest release keeps a server's desktop bundle (scripts/bundle.ts names it). */
export const bundleUrl = (m: Manifest): string => `${m.repository.url}/releases/latest/download/${bundleFile(m)}`;

/** A server's desktop bundle's file name: no version, so the newest release's is always at one address. */
export const bundleFile = (m: Manifest): string => `mcp-${m.server}.mcpb`;

/** What a README's commands put where a person's own value goes: `<path to Oblio app.json>`. */
const placeholder = (input: Input): string => (input.type === "file" || input.type === "directory" ? `<path to ${input.title}>` : `<${input.title}>`);

/** The settings a command or configuration names: the required ones; the rest are in Configuration. */
const requiredOf = (m: Manifest): readonly Input[] => m.inputs.filter((i) => i.required);

/** Claude Code's command for a server started by `command`. */
const claudeCommand = (m: Manifest, command: string): string =>
  ["claude mcp add", m.server, ...requiredOf(m).map((i) => `-e ${i.name}="${placeholder(i)}"`), "--", command].join(" ");

/** The JSON most clients read (Claude Desktop's claude_desktop_config.json, among others). */
const jsonConfig = (m: Manifest, command: string, args: readonly string[]): string => {
  const env = requiredOf(m);
  return [
    "{",
    '  "mcpServers": {',
    `    "${m.server}": {`,
    `      "command": "${command}",`,
    `      "args": [${args.map((a) => `"${a}"`).join(", ")}]${env.length === 0 ? "" : ","}`,
    ...(env.length === 0 ? [] : ['      "env": {', ...env.map((i, n) => `        "${i.name}": "${placeholder(i)}"${n < env.length - 1 ? "," : ""}`), "      }"]),
    "    }",
    "  }",
    "}",
  ].join("\n");
};

/** What the README says about the settings: who asks for which, and where they are explained. */
const settingsOf = (m: Manifest): string => {
  if (m.inputs.length === 0) return "It needs no settings.";
  const required = requiredOf(m);
  const first = m.inputs[0]?.name ?? "";
  const one = m.inputs.length === 1;
  return [
    one
      ? `VS Code and the Claude Desktop bundle ask for \`${first}\` as they add the server.`
      : "VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty.",
    `Cursor reads ${one ? "it" : "each"} from your environment instead (\`\${env:${first}}\`${one ? "" : " and so on"}), so set ${one ? "it" : "them"} before you start Cursor.`,
    required.length === m.inputs.length
      ? `[Configuration](#configuration) says what ${one ? "it holds" : "each holds"}.`
      : required.length === 0
        ? "Every setting is optional; [Configuration](#configuration) says which ones you need for which tools."
        : "The commands above set only what is required; [Configuration](#configuration) has the rest.",
  ].join(" ");
};

/**
 * The README's install block, between `<!-- install:begin -->` and
 * `<!-- install:end -->`, at the top of "Install": the buttons, the Claude
 * Code command and the JSON other clients read, all running the published
 * package, then the same from a clone. While the package is private it is not
 * on npm, and the block says so before anyone presses a button that fails.
 */
export const installBlock = (m: Manifest): string => {
  const node = m.node.replace(/^>=\s*/, "");
  const badge = (label: string, message: string, colour: string, logo: string): string => `https://img.shields.io/badge/${label}-${message}-${colour}?style=flat-square&logo=${logo}&logoColor=white`;
  const entry = `servers/${m.server}/${m.bin.replace(/^\.\//, "")}`;
  return [
    [
      `[![Install in VS Code](${badge("VS_Code", "Install_Server", "0098FF", "visualstudiocode")})](${vscodeLink(m)})`,
      `[![Install in Cursor](${badge("Cursor", "Install_Server", "000000", "cursor")})](${cursorLink(m)})`,
      `[![Download for Claude Desktop](${badge("Claude_Desktop", "Download_Bundle", "D97757", "claude")})](${bundleUrl(m)})`,
    ].join(" "),
    "",
    ...(m.private
      ? [
          "> [!NOTE]",
          `> \`${m.name}\` is not on npm yet: the buttons and the \`npx\` commands below work once it is published. Until then, [run it from a clone](#from-a-clone).`,
          "",
        ]
      : []),
    "With Claude Code:",
    "",
    "```bash",
    claudeCommand(m, `npx -y ${m.name}`),
    "```",
    "",
    "Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON:",
    "",
    "```json",
    jsonConfig(m, "npx", ["-y", m.name]),
    "```",
    "",
    `Each runs the published package on Node ${node} or newer. ${settingsOf(m)}`,
    "",
    "### From a clone",
    "",
    "```bash",
    `git clone ${m.repository.url}.git && cd ${m.repository.url.split("/").pop() ?? ""}`,
    "npm ci && npm run build",
    claudeCommand(m, `node "$PWD/${entry}"`),
    "```",
    "",
    `In a JSON configuration, the command is \`node\` and its one argument the full path of \`${entry}\`. To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).`,
  ].join("\n");
};

/** The `.mcpb` manifest version these bundles follow (modelcontextprotocol/mcpb, MANIFEST.md). */
export const MCPB_MANIFEST_VERSION = "0.3";

type UserConfig = { readonly type: "file" | "directory" | "string"; readonly title: string; readonly description: string; readonly required: boolean; readonly sensitive?: true };

const userConfig = (input: Input): UserConfig => ({
  type: input.type === "file" || input.type === "directory" ? input.type : "string",
  title: input.title,
  description: input.description,
  required: input.required,
  ...(input.type === "secret" ? { sensitive: true as const } : {}),
});

/**
 * A server's desktop bundle manifest. The bundle holds the package and its
 * dependencies under node_modules/, and the client runs its bin with its own
 * Node. A path is asked as a file or folder, a secret as a sensitive field
 * (kept in the system's keychain), and a plain value as text.
 */
export const bundleManifest = (m: Manifest, tools: readonly { readonly name: string; readonly description: string }[]): Readonly<Record<string, unknown>> => {
  const entry = `node_modules/${m.name}/${m.bin}`;
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: `mcp-${m.server}`,
    display_name: m.title,
    version: m.version,
    description: m.summary,
    long_description: m.description,
    author: { name: m.author },
    repository: { type: "git", url: m.repository.url },
    homepage: m.homepage,
    documentation: m.homepage,
    support: m.bugs,
    icon: "icon.png",
    icons: [{ src: "icon.png", size: "512x512" }],
    server: {
      type: "node",
      entry_point: entry,
      mcp_config: {
        command: "node",
        args: [`\${__dirname}/${entry}`],
        ...(m.inputs.length === 0 ? {} : { env: Object.fromEntries(m.inputs.map((i) => [i.name, `\${user_config.${keyOf(i)}}`])) }),
      },
    },
    ...(m.inputs.length === 0 ? {} : { user_config: Object.fromEntries(m.inputs.map((i) => [keyOf(i), userConfig(i)])) }),
    tools,
    tools_generated: false,
    keywords: m.keywords,
    license: m.license,
    compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: m.node } },
  };
};
