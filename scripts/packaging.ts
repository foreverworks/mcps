/**
 * What a server says about itself, derived from its package.json, the one
 * place a server says what it is and who it is for: where the root README
 * lists it, its npm keywords, its registry entry (`server.json`, for the
 * official MCP Registry), its desktop bundle's manifest (`.mcpb`), the install
 * block in its README, and whether it is published at all. check-docs writes
 * and checks them, the release builds and publishes them; nothing here is
 * typed twice.
 *
 * A server's package.json carries, beside the npm fields:
 *
 *   "mcp": {
 *     "title": "Oblio",                            a person's name for it
 *     "audience": "romania",                       who it is for (AUDIENCE below)
 *     "maturity": "stable",                        how settled it is (MATURITY below)
 *     "tagline": "Issue and track ...",            one sentence for a stranger (taglineProblems)
 *     "inputs": {                                  what a person sets to install it
 *       "OBLIO_CONFIG": { "title": "Oblio app.json", "type": "file", "required": true, "description": "Path of app.json ..." }
 *     }
 *   }
 *
 * and, written from those by `check-docs --write`: its `keywords` (the base
 * and its audience's first, then its own), its `homepage` (its page on the
 * site, which scripts/site.ts builds from the same fields), and for a
 * server that ships its `mcpName` (`com.foreverworks/<server>`, the registry
 * name npm proves is ours) and `server.json`; an extras server instead says
 * `"private": true` and has neither. Its `description` is npm's, written by hand: what it
 * serves, then what an assistant can do with it.
 *
 * An input's `type` is `file` or `directory` (a path: a credential lives in a
 * file, docs/configuration.md), `text` (a plain value such as a time zone) or
 * `secret` (a value that is itself a secret, for a server with no file
 * variable for it). A secret is never put in a plain field: the registry
 * entry marks it isSecret, a bundle marks it sensitive, a VS Code link asks
 * for it as a password, and a Cursor link, whose configuration is a plain
 * file, leaves it for the person to fill in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The registry's server.json schema these entries follow. */
export const SERVER_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

/** The registry namespace, proven by a DNS record on foreverworks.com (docs/releasing.md). */
export const NAMESPACE = "com.foreverworks";

/**
 * The repository's site (GitHub Pages, built by scripts/site.ts from the same
 * package.json fields and READMEs): every server's home page is its page there.
 */
export const SITE = "https://foreverworks.github.io/mcps/";

/** A server's page on the site: its package.json `homepage`, which check-docs writes. */
export const homepageOf = (server: string): string => `${SITE}servers/${server}/`;

/** The npm scope every server is published under, as `mcp-<server>`. */
const SCOPE = "@foreverworks/";

/** The registry's limit on a description, which is the server's tagline. */
export const TAGLINE_MAX = 100;

/**
 * Who a server is for. Each audience is a section of the root README, in
 * this order, and decides whether its servers are published: an extras
 * server never goes to npm, the MCP Registry or a desktop bundle, and its
 * package.json says `"private": true` so that npm refuses it too.
 */
export const AUDIENCES = ["romania", "general", "extras"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type AudienceSpec = {
  /** The heading of its section in the root README. */
  readonly heading: string;
  /** What its section says before the table. */
  readonly intro: string;
  /** One word for it, where a heading has no room: the site's navigation. */
  readonly label: string;
  /** npm keywords every server of the audience carries, true of each one. */
  readonly keywords: readonly string[];
  /** Whether its servers are published: to npm, to the MCP Registry, as desktop bundles. */
  readonly ships: boolean;
};

export const AUDIENCE: Readonly<Record<Audience, AudienceSpec>> = {
  romania: {
    heading: "For companies in Romania",
    intro:
      "The paperwork a company in Romania, and the people who run it, do online: e-invoices and declarations with ANAF, filings at the trade register, invoicing, and the National Bank's exchange rates. Each README ends with the other servers we found for that service, and what this one adds.",
    label: "Romania",
    keywords: ["romania", "romanian"],
    ships: true,
  },
  general: {
    heading: "For everyone",
    intro:
      "Servers for services people use anywhere. We built each one because the servers we found did less, or there were none; each README's last section names them and says what this one adds.",
    label: "Everyone",
    keywords: [],
    ships: true,
  },
  extras: {
    heading: "Extras",
    intro:
      "These work, and we use them, but each is built for one particular setup or on an app's unofficial API, so they are not published to npm, the MCP Registry or as desktop bundles. Run them from a clone, and read the README first: it says what the server depends on and what can break.",
    label: "Extras",
    keywords: [],
    ships: false,
  },
};

/** How settled a server is, as the root README shows it under its name. */
export const MATURITIES = ["stable", "beta", "experimental"] as const;
export type Maturity = (typeof MATURITIES)[number];

export const MATURITY: Readonly<Record<Maturity, string>> = {
  stable: "in daily use, and its tools keep their shape",
  beta: "works and is in use, but is new, still growing, or reads web pages its service may change",
  experimental: "rests on something that can break without notice, or covers only part of the service",
};

/** npm keywords every server carries. */
export const BASE_KEYWORDS = ["mcp", "model-context-protocol", "mcp-server"] as const;

/**
 * A server's npm keywords: the base ones, its audience's, then its own, which
 * are the ones package.json has that no audience generates. Changing a
 * server's audience changes its keywords with it.
 */
export const keywordsOf = (audience: Audience, current: readonly string[]): readonly string[] => {
  const generated = new Set<string>([...BASE_KEYWORDS, ...AUDIENCES.flatMap((a) => AUDIENCE[a].keywords)]);
  return [...new Set([...BASE_KEYWORDS, ...AUDIENCE[audience].keywords, ...current.filter((k) => !generated.has(k))])];
};

/** GitHub's limit on a repository's topics. */
export const TOPICS_MAX = 20;

/**
 * The repository's GitHub topics, which is how a stranger finds it there: the
 * base keywords, every published audience's, then each published server's
 * first own keyword, the one that names its service. Extras are left out, as
 * they are from every listing.
 */
export const topicsOf = (manifests: readonly Pick<Manifest, "audience" | "keywords">[]): readonly string[] => {
  const generated = new Set<string>([...BASE_KEYWORDS, ...AUDIENCES.flatMap((a) => AUDIENCE[a].keywords)]);
  const published = AUDIENCES.filter((a) => AUDIENCE[a].ships);
  const own = published.flatMap((a) => manifests.filter((m) => m.audience === a).flatMap((m) => m.keywords.filter((k) => !generated.has(k)).slice(0, 1)));
  return [...new Set([...BASE_KEYWORDS, ...published.flatMap((a) => AUDIENCE[a].keywords), ...own])];
};

/** Words a tagline does without (CONTRIBUTING.md, "How we write"). */
const HYPE = /\b(powerful|seamless(ly)?|simply|effortless(ly)?|blazing|robust|cutting-edge|supercharge)\b/i;

/**
 * What keeps a tagline from being one sentence a stranger reads in the
 * registry, a desktop bundle and the root README: at most TAGLINE_MAX
 * characters, one sentence ending in a full stop, no dash for a pause, no
 * hype, and no "MCP server", which every reader there already knows.
 */
export const taglineProblems = (tagline: string): readonly string[] => [
  ...(tagline.length > TAGLINE_MAX ? [`mcp.tagline is ${tagline.length} characters; the registry takes ${TAGLINE_MAX}`] : []),
  ...(/^[A-Z]/.test(tagline) && tagline.endsWith(".") ? [] : ["mcp.tagline must be a sentence: a capital letter first, a full stop last"]),
  ...(/[.!?]\s/.test(tagline) ? ["mcp.tagline must be one sentence"] : []),
  ...(/[\u2014\u2013]|\s-\s/.test(tagline) ? ["mcp.tagline has a dash; use a comma or a colon"] : []),
  ...(HYPE.test(tagline) ? [`mcp.tagline says "${HYPE.exec(tagline)?.[0] ?? ""}"; say what it does instead`] : []),
  ...(/\bMCP server\b/i.test(tagline) ? ["mcp.tagline says \"MCP server\"; say what it lets an assistant do"] : []),
];

/** The keys an `mcp` block may have; anything else is a typo or a field nothing reads. */
const MCP_KEYS = new Set(["title", "audience", "maturity", "tagline", "inputs"]);

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
  /** npm's description: what it serves, then what an assistant can do with it. */
  readonly description: string;
  readonly audience: Audience;
  readonly maturity: Maturity;
  /** One sentence for a stranger: the registry's description, a bundle's, the root README's. */
  readonly tagline: string;
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
  /**
   * package.json `private`. For a server that ships, the release does not
   * publish it yet, and its README says so; an extras server is always private.
   */
  readonly private: boolean;
};

/** Whether a server is ever published: its audience decides. */
export const shipsOf = (m: Pick<Manifest, "audience">): boolean => AUDIENCE[m.audience].ships;

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
  const mcp = isRecord(pkg.mcp) ? pkg.mcp : undefined;
  if (mcp === undefined) problems.push(`package.json has no "mcp" block (scripts/packaging.ts says what goes in it)`);
  for (const key of Object.keys(mcp ?? {})) if (!MCP_KEYS.has(key)) problems.push(`package.json has mcp.${key}, which nothing reads: the block holds ${[...MCP_KEYS].join(", ")}`);
  const title = text(mcp?.["title"], `mcp.title`);
  const audience = mcp?.["audience"];
  if (!AUDIENCES.includes(audience as Audience)) problems.push(`mcp.audience is ${JSON.stringify(audience ?? null)}; it must be one of ${AUDIENCES.join(", ")}`);
  const maturity = mcp?.["maturity"];
  if (!MATURITIES.includes(maturity as Maturity)) problems.push(`mcp.maturity is ${JSON.stringify(maturity ?? null)}; it must be one of ${MATURITIES.join(", ")}`);
  const tagline = text(mcp?.["tagline"], "mcp.tagline");
  if (tagline !== "") problems.push(...taglineProblems(tagline));
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
    audience: audience as Audience,
    maturity: maturity as Maturity,
    tagline,
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

/**
 * A workspace (packages/* or servers/*) as a release sees it, with whether it
 * is ever published. A server ships when its audience does; a package ships
 * when something that ships depends on it, so a package only the extras use
 * is never published either. `private` is the other gate: a workspace that
 * ships is published once it is no longer private.
 */
export type Workspace = {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  /** The @foreverworks packages it depends on. */
  readonly internal: readonly string[];
  readonly mcpName?: string;
  /** A server's audience; a package has none. */
  readonly audience?: Audience;
  readonly ships: boolean;
};

type WorkspaceJson = {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly mcpName?: string;
  readonly mcp?: { readonly audience?: unknown };
  readonly dependencies?: Readonly<Record<string, string>>;
};

/**
 * Every workspace, the packages first (a server depends on them by version
 * range), and the problems that keep one from saying whether it ships: a
 * server without a known audience.
 */
export const readWorkspaces = (root: string): { readonly workspaces: readonly Workspace[]; readonly problems: readonly string[] } => {
  const problems: string[] = [];
  const read = ["packages", "servers"].flatMap((parent) =>
    readdirSync(join(root, parent))
      .sort()
      .map((folder) => {
        const dir = `${parent}/${folder}`;
        const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as WorkspaceJson;
        const audience = parent === "servers" ? pkg.mcp?.audience : undefined;
        if (parent === "servers" && !AUDIENCES.includes(audience as Audience)) problems.push(`${dir}: package.json's mcp.audience must be one of ${AUDIENCES.join(", ")}`);
        return {
          dir,
          name: pkg.name,
          version: pkg.version,
          private: pkg.private === true,
          internal: Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith(SCOPE)),
          ...(pkg.mcpName === undefined ? {} : { mcpName: pkg.mcpName }),
          ...(AUDIENCES.includes(audience as Audience) ? { audience: audience as Audience } : {}),
        };
      }),
  );
  // A server ships by its audience; then a package ships while anything that ships needs it.
  const ships = new Set(read.filter((w) => w.audience !== undefined && AUDIENCE[w.audience].ships).map((w) => w.name));
  for (let before = -1; ships.size !== before; ) {
    before = ships.size;
    for (const w of read) if (ships.has(w.name)) w.internal.forEach((dep) => ships.add(dep));
  }
  return { workspaces: read.map((w) => ({ ...w, ships: ships.has(w.name) })), problems };
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
  description: m.tagline,
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

/**
 * The packages in what `npm pack --json` printed: npm 11 prints an array,
 * npm 12 an object keyed by package name. CI runs Node's own npm and the
 * release installs npm 12, so both reach this.
 */
export const packedEntries = <T>(printed: string): readonly T[] => {
  const answer = JSON.parse(printed) as readonly T[] | Readonly<Record<string, T>>;
  return Array.isArray(answer) ? (answer as readonly T[]) : Object.values(answer);
};

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
  const first = m.inputs[0]?.name ?? "";
  const one = m.inputs.length === 1;
  return [
    one
      ? `VS Code and the Claude Desktop bundle ask for \`${first}\` as they add the server.`
      : "VS Code and the Claude Desktop bundle ask for each setting as they add the server; leave an optional one empty.",
    `Cursor reads ${one ? "it" : "each"} from your environment instead (\`\${env:${first}}\`${one ? "" : " and so on"}), so set ${one ? "it" : "them"} before you start Cursor.`,
    whereExplained(m),
  ].join(" ");
};

/** Where the README explains the settings: the commands set the required ones. */
const whereExplained = (m: Manifest): string => {
  const required = requiredOf(m);
  if (m.inputs.length === 0) return "It needs no settings.";
  if (required.length === m.inputs.length) return `[Configuration](#configuration) says what ${m.inputs.length === 1 ? "it holds" : "each holds"}.`;
  if (required.length === 0) return "Every setting is optional; [Configuration](#configuration) says which ones you need for which tools.";
  return "The commands above set only what is required; [Configuration](#configuration) has the rest.";
};

/** The built server's entry point, from the repository's root. */
const entryOf = (m: Manifest): string => `servers/${m.server}/${m.bin.replace(/^\.\//, "")}`;

/** The commands that clone the repository and build every server. */
const cloneCommands = (m: Manifest): readonly string[] => [`git clone ${m.repository.url}.git && cd ${m.repository.url.split("/").pop() ?? ""}`, "npm ci && npm run build"];

const DEPLOYING = "To share one running copy between several clients over HTTP, see [docs/deploying.md](../../docs/deploying.md).";

/**
 * The install block of a server that is never published (an extras server):
 * no buttons and no npx, which would point at a package that will never
 * exist, but why not, and the clone it runs from.
 */
const extrasInstallBlock = (m: Manifest): string => {
  const entry = entryOf(m);
  return [
    "> [!NOTE]",
    `> ${m.title} is one of this repository's [extras](../../README.md#extras), which are not published to npm, the MCP Registry or as desktop bundles: each is built for one particular setup or on an app's unofficial API. Run it from a clone, on Node ${m.node.replace(/^>=\s*/, "")} or newer.`,
    "",
    "With Claude Code:",
    "",
    "```bash",
    ...cloneCommands(m),
    claudeCommand(m, `node "$PWD/${entry}"`),
    "```",
    "",
    `Claude Desktop (Settings, Developer, Edit Config) and most other clients read the same command as JSON, with the full path of \`${entry}\` in your clone:`,
    "",
    "```json",
    jsonConfig(m, "node", [`<path to the clone>/${entry}`]),
    "```",
    "",
    `${whereExplained(m)} ${DEPLOYING}`,
  ].join("\n");
};

/**
 * The README's install block, between `<!-- install:begin -->` and
 * `<!-- install:end -->`, at the top of "Install": the buttons, the Claude
 * Code command and the JSON other clients read, all running the published
 * package, then the same from a clone. While the package is private it is not
 * on npm, and the block says so before anyone presses a button that fails.
 * An extras server is never published, and its block says that instead.
 */
export const installBlock = (m: Manifest): string => {
  if (!shipsOf(m)) return extrasInstallBlock(m);
  const node = m.node.replace(/^>=\s*/, "");
  const badge = (label: string, message: string, colour: string, logo: string): string => `https://img.shields.io/badge/${label}-${message}-${colour}?style=flat-square&logo=${logo}&logoColor=white`;
  const entry = entryOf(m);
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
    ...cloneCommands(m),
    claudeCommand(m, `node "$PWD/${entry}"`),
    "```",
    "",
    `In a JSON configuration, the command is \`node\` and its one argument the full path of \`${entry}\`. ${DEPLOYING}`,
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
    description: m.tagline,
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
