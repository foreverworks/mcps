/**
 * Holds the documentation to the code, so a README cannot drift from what a
 * server does. Run by `npm run check` after the build:
 *
 * 1. Every server STARTS with an empty environment (credentials are a tool's
 *    config failure, never a refusal to start), so a client can always list it.
 * 2. Its README's tool tables name every tool it registers, each once, with the
 *    access class its policy gives it (read, write or money, as `tools/list`
 *    carries it in `_meta`), and no tool it does not register.
 * 3. Every environment variable its source reads is documented, in its README
 *    or, for the variables every server shares, in docs/configuration.md.
 * 4. It gives server instructions at initialize: what it serves and where a
 *    model should start, read before any tool description.
 * 5. Its CHANGELOG.md names every `money` tool, and its package.json makes a
 *    registry entry: `mcpName` and `server.json` are written from it
 *    (scripts/packaging.ts).
 * 6. Its icons are the ones scripts/icons.ts draws, and it announces its own.
 * 7. Its README's install block (VS Code and Cursor links, the desktop bundle,
 *    the commands for Claude Code and other clients, at the top of "Install")
 *    is the one its package.json makes.
 *
 * A README whose tools change with a vendor's release (porkbun) generates its
 * table instead: between `<!-- tools:begin -->` and `<!-- tools:end -->`, one row
 * per tool, from `tools/list`. The root README's table of servers is generated
 * the same way, between `<!-- servers:begin -->` and `<!-- servers:end -->`, from
 * each workspace's package.json `description`, the one place a server says what
 * it is. `--write` rewrites those blocks; the check fails when one is out of date.
 *
 *   npx tsx scripts/check-docs.ts [--write] [server ...]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { listServer } from "./listed.js";
import { installBlock, jsonText, mcpNameOf, readManifest, serverJson, type Manifest } from "./packaging.js";
import { GLYPHS, iconsDir, iconSvg, PRODUCTS } from "./icons.js";
import { accessOf, names, toolRows } from "./readme.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ACCESS_META = "foreverworks.com/access";

/** Source files under a directory, tests excluded. */
const sources = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [path] : [];
  });

/** The names a source reads from the environment, by the ways this repo reads them. */
const ENV_READS = [
  /env\[\s*"([A-Z][A-Z0-9_]+)"\s*\]/g,
  /env\.([A-Z][A-Z0-9_]+)\b/g,
  /(?:envPath|unsetPath|timeZoneOf|stateDirOf)\([^)]*?"([A-Z][A-Z0-9_]+)"/g,
  /\b(?:file|value):\s*"([A-Z][A-Z0-9_]+)"/g,
];

const envReadIn = (dir: string): ReadonlySet<string> =>
  new Set(sources(dir).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return ENV_READS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1] as string));
  }));

/** Every backticked UPPER_CASE name in a document. */
const documentedIn = (text: string): ReadonlySet<string> => new Set([...text.matchAll(/`([A-Z][A-Z0-9_]+)(?:=[^`]*)?`/g)].map((m) => m[1] as string));

/** Process variables every program may read; not this repo's to document. */
const PLATFORM = new Set(["HOME", "PATH", "TZ", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "NODE_ENV"]);

type Listed = { readonly access: string; readonly description: string };

const BEGIN = "<!-- tools:begin -->";
const END = "<!-- tools:end -->";

/**
 * The first sentence of a description, for one table cell. A vendor's dash
 * becomes a colon: the README's house style has none (CONTRIBUTING.md).
 */
const firstSentence = (description: string): string => {
  const flat = description.replace(/\s+/g, " ").replace(/\s[\u2014\u2013]\s/g, ": ").replace(/\|/g, "\\|").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
};

const generatedTable = (tools: ReadonlyMap<string, Listed>): string =>
  [
    "| Tool | Access | What it does |",
    "|---|---|---|",
    ...[...tools].map(([name, t]) => `| \`${name}\` | ${t.access === "money" ? "**money**" : t.access} | ${firstSentence(t.description)} |`),
  ].join("\n");

/** The README with its generated block, if it has one, rebuilt from the tools. */
const withGenerated = (readme: string, tools: ReadonlyMap<string, Listed>): string => {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (begin === -1 || end < begin) return readme;
  return `${readme.slice(0, begin + BEGIN.length)}\n${generatedTable(tools)}\n${readme.slice(end)}`;
};

const INSTALL_BEGIN = "<!-- install:begin -->";
const INSTALL_END = "<!-- install:end -->";
const USING = "## Install\n";

/**
 * The README with its install block (VS Code and Cursor links, the desktop
 * bundle) rebuilt from package.json; a README without one gets it at the top
 * of "Using it".
 */
const withInstall = (readme: string, manifest: Manifest | undefined): string => {
  if (manifest === undefined) return readme;
  const block = `${INSTALL_BEGIN}\n${installBlock(manifest)}\n${INSTALL_END}`;
  const begin = readme.indexOf(INSTALL_BEGIN);
  const end = readme.indexOf(INSTALL_END);
  if (begin !== -1 && end > begin) return `${readme.slice(0, begin)}${block}${readme.slice(end + INSTALL_END.length)}`;
  const using = readme.indexOf(USING);
  if (using === -1) return readme;
  const at = using + USING.length;
  return `${readme.slice(0, at)}\n${block}\n${readme.slice(at)}`;
};

/**
 * A server README's sections, in order (CONTRIBUTING.md, "Writing a server's
 * README"): the required ones always, Money exactly when a tool is `money`,
 * and nothing else at that level, so a reader finds the same thing in the
 * same place in every server.
 */
const SECTIONS: readonly { readonly heading: string; readonly required: boolean }[] = [
  { heading: "What you can ask", required: true },
  { heading: "Install", required: true },
  { heading: "Configuration", required: true },
  { heading: "First run", required: false },
  { heading: "Tools", required: true },
  { heading: "Money", required: false },
  { heading: "Troubleshooting", required: false },
  { heading: "How it works", required: false },
  { heading: "Limitations", required: true },
  { heading: "Other servers for", required: true },
];

/** The README's level-two headings, outside fenced code. */
const headingsOf = (readme: string): readonly string[] => {
  let fenced = false;
  return readme.split("\n").flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && line.startsWith("## ") ? [line.slice(3).trim()] : [];
  });
};

/** What keeps a README from the template: its title, and its sections and their order. */
const checkSections = (readme: string, title: string, hasMoney: boolean): readonly string[] => {
  const problems: string[] = [];
  // GitHub links an image to its own file, so the icon's alt text names that link.
  const h1 = `# <img src="icons/icon.svg" width="36" height="36" alt="${title} icon"> ${title} MCP server`;
  if (!readme.startsWith(`${h1}\n`)) problems.push(`README.md must open with \`${h1}\``);
  const sectionOf = (heading: string): number => SECTIONS.findIndex((s) => heading === s.heading || (s.heading.endsWith(" for") && heading.startsWith(`${s.heading} `)));
  let last = -1;
  const found = new Set<number>();
  for (const heading of headingsOf(readme)) {
    const at = sectionOf(heading);
    if (at === -1) problems.push(`README.md has a section "${heading}" the template does not (CONTRIBUTING.md); make it a ### under one that it has`);
    else if (at <= last) problems.push(`README.md's "${heading}" is out of order or repeated: the sections go ${SECTIONS.map((s) => s.heading).join(", ")}`);
    else {
      last = at;
      found.add(at);
    }
  }
  SECTIONS.forEach((s, at) => {
    if (s.required && !found.has(at)) problems.push(`README.md has no "${s.heading}${s.heading.endsWith(" for") ? " <service>" : ""}" section`);
  });
  const money = found.has(SECTIONS.findIndex((s) => s.heading === "Money"));
  if (hasMoney && !money) problems.push(`README.md has \`money\` tools and no "Money" section`);
  if (!hasMoney && money) problems.push(`README.md has a "Money" section and no \`money\` tool`);
  return problems;
};

type Started = {
  readonly tools: ReadonlyMap<string, Listed>;
  readonly instructions: string;
  readonly icons: number;
  /** Where a client of protocol 2026-07-28 is told something else than one of 2025-11-25 (empty when they agree). */
  readonly eras: readonly string[];
};

/** JSON with every object's keys in order: the two generations put `$schema` at different places. */
const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : typeof value === "object" && value !== null
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(value);

/** Tools, instructions and icons as each protocol generation lists them, and every way they differ. */
const differences = (legacy: Awaited<ReturnType<typeof listServer>>, modern: Awaited<ReturnType<typeof listServer>>): readonly string[] => {
  // Each listing ran with its own temporary HOME, which a description may name (google's default download folder).
  const byName = ({ tools, home }: typeof legacy) => new Map(tools.map((t) => [t.name, canonical(t).replaceAll(home, "$HOME")]));
  const [a, b] = [byName(legacy), byName(modern)];
  const tools = [...new Set([...a.keys(), ...b.keys()])].filter((name) => a.get(name) !== b.get(name)).map((name) => `tool ${name}`);
  return [
    ...tools,
    ...(legacy.instructions === modern.instructions ? [] : ["instructions"]),
    ...(canonical(legacy.server?.icons ?? []) === canonical(modern.server?.icons ?? []) ? [] : ["server icons"]),
  ];
};

const listTools = async (dir: string): Promise<Started> => {
  const [legacy, modern] = [await listServer(dir, "legacy"), await listServer(dir, "modern")];
  const { tools, instructions, server } = legacy;
  return {
    tools: new Map(tools.map((t) => [t.name, { access: String(t._meta?.[ACCESS_META] ?? "unclassified"), description: t.description ?? "" }])),
    instructions,
    icons: server?.icons?.length ?? 0,
    eras: differences(legacy, modern),
  };
};

/**
 * A server's icons: each file scripts/icons.ts writes is there, every SVG as
 * it draws it today (a glyph changed and not written fails here), and the
 * server announces its icon at initialize.
 */
const checkIcons = (server: string, announced: number): readonly string[] => {
  const glyph = GLYPHS[server];
  if (glyph === undefined) return [`has no glyph in scripts/icons.ts: draw one (its header says how), then npx tsx scripts/icons.ts`];
  const dir = iconsDir(server);
  const wanted = [
    { file: "icon.svg", svg: iconSvg(glyph) },
    { file: "icon-48.png" },
    { file: "icon-512.png" },
    ...Object.entries(PRODUCTS[server] ?? {}).flatMap(([product, own]) => [{ file: `${product}.svg`, svg: iconSvg(own) }, { file: `${product}-32.png` }]),
  ];
  const problems = wanted.flatMap(({ file, svg }) => {
    const path = join(dir, file);
    if (!existsSync(path)) return [`icons/${file} is missing (npx tsx scripts/icons.ts)`];
    return svg !== undefined && readFileSync(path, "utf8") !== svg ? [`icons/${file} is not what scripts/icons.ts draws (npx tsx scripts/icons.ts)`] : [];
  });
  if (announced === 0) problems.push("announces no icon at initialize: pass serve() ...packageIdentity(import.meta.url)");
  return problems;
};

/**
 * The installer-facing files a server's package.json implies (scripts/packaging.ts):
 * its `mcpName` and its registry entry `server.json`, written under --write. Each
 * declared input must be a variable the README documents (and so one it reads:
 * some are read under a composed name, `<PREFIX>_CREDS`, that a search misses).
 */
const checkPackaging = (dir: string, server: string, documented: ReadonlySet<string>, write: boolean): { readonly problems: readonly string[]; readonly manifest?: Manifest } => {
  const pkgPath = join(dir, "package.json");
  const pkgText = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(pkgText) as Record<string, unknown>;
  const problems: string[] = [];
  const wanted = mcpNameOf(server);
  if (pkg["mcpName"] !== wanted) {
    if (write) {
      // mcpName sits after the description, where a reader of the package looks for what it is.
      const entries = Object.entries(pkg).filter(([key]) => key !== "mcpName");
      const at = entries.findIndex(([key]) => key === "description") + 1;
      entries.splice(at, 0, ["mcpName", wanted]);
      writeFileSync(pkgPath, jsonText(Object.fromEntries(entries)));
    } else problems.push(`package.json's mcpName is ${JSON.stringify(pkg["mcpName"] ?? null)}, not "${wanted}" (npx tsx scripts/check-docs.ts --write)`);
  }
  const { manifest, problems: unreadable } = readManifest(ROOT, server);
  problems.push(...unreadable);
  if (manifest === undefined) return { problems };
  for (const input of manifest.inputs) {
    if (!documented.has(input.name)) problems.push(`package.json's mcp.inputs names \`${input.name}\`, which the README does not document`);
  }
  const entryPath = join(dir, "server.json");
  const entry = jsonText(serverJson({ ...manifest, mcpName: wanted }));
  const current = (() => {
    try {
      return readFileSync(entryPath, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== entry) {
    if (write) writeFileSync(entryPath, entry);
    else problems.push("server.json is out of date with package.json (npx tsx scripts/check-docs.ts --write)");
  }
  return { problems, manifest };
};

/**
 * A package's changelog, which a person reads before upgrading: it must exist,
 * and name every `money` tool the package has, so a tool that moves money is
 * never one its users were not told about (.changeset/README.md says how).
 * Changes of class since a release are scripts/access-changes.ts's to hold.
 */
const checkChangelog = (dir: string, tools: ReadonlyMap<string, Listed>): readonly string[] => {
  const path = join(dir, "CHANGELOG.md");
  if (!existsSync(path)) return ["has no CHANGELOG.md (.changeset/README.md)"];
  const changelog = readFileSync(path, "utf8");
  return [...tools]
    .filter(([tool, t]) => t.access === "money" && !names(changelog, tool))
    .map(([tool]) => `CHANGELOG.md never names \`${tool}\`, a money tool: say in a changeset that it moves money (.changeset/README.md)`);
};

const checkServer = async (name: string, shared: ReadonlySet<string>, write: boolean): Promise<readonly string[]> => {
  const dir = join(ROOT, "servers", name);
  const path = join(dir, "README.md");
  const original = readFileSync(path, "utf8");
  const problems: string[] = [];

  let started: Started;
  try {
    started = await listTools(dir);
  } catch (error) {
    return [`does not start with an empty environment (${String(error).slice(0, 160)}); a missing credential must fail the tool that needs it, not the start`];
  }
  const { tools } = started;
  problems.push(...checkIcons(name, started.icons));
  if (started.eras.length > 0) {
    problems.push(`lists differently to protocol 2025-11-25 and 2026-07-28 clients (${started.eras.join(", ")}): both generations must see one surface`);
  }
  if (started.instructions.trim() === "") problems.push("gives no server instructions: pass serve() `instructions` saying what it serves and which tool to start with");
  const packaging = checkPackaging(dir, name, documentedIn(original), write);
  problems.push(...packaging.problems);
  const readme = withInstall(withGenerated(original, tools), packaging.manifest);
  if (readme !== original) {
    if (write) writeFileSync(path, readme);
    else problems.push("README.md's generated tool table or install block is out of date (npx tsx scripts/check-docs.ts --write)");
  }
  if (packaging.manifest !== undefined && !readme.includes(INSTALL_BEGIN)) problems.push(`README.md has no "${USING.trim()}" section for its install block`);
  const rows = toolRows(readme);
  const seen = new Map<string, number>();
  for (const row of rows) {
    for (const tool of row.tools) {
      const access = tools.get(tool)?.access;
      if (access === undefined) problems.push(`README.md:${row.line} names \`${tool}\`, which the server does not register`);
      else if (access !== row.access) problems.push(`README.md:${row.line} says \`${tool}\` is ${row.access}; its policy says ${access}`);
      if (seen.has(tool)) problems.push(`README.md:${row.line} lists \`${tool}\` again (first at line ${seen.get(tool)})`);
      seen.set(tool, row.line);
    }
  }
  for (const tool of tools.keys()) if (!seen.has(tool)) problems.push(`\`${tool}\` is registered but missing from the README's tool tables`);
  problems.push(...checkChangelog(dir, tools));
  if (packaging.manifest !== undefined) problems.push(...checkSections(readme, packaging.manifest.title, [...tools.values()].some((t) => t.access === "money")));

  const documented = documentedIn(readme);
  for (const variable of envReadIn(join(dir, "src"))) {
    if (!documented.has(variable) && !shared.has(variable) && !PLATFORM.has(variable)) {
      problems.push(`reads \`${variable}\`, which neither its README nor docs/configuration.md documents`);
    }
  }
  return problems;
};

const SERVERS_BEGIN = "<!-- servers:begin -->";
const SERVERS_END = "<!-- servers:end -->";

/**
 * The groups of the root README's table of servers, in the order a reader
 * meets them. Each server names its own in its package.json `mcp.group`.
 */
const GROUPS = ["Workspace", "Money and accounting", "Romanian authorities", "Apps and developer tools", "Domains and brands"];

type Described = { readonly name: string; readonly description: string; readonly mcp?: { readonly title?: string; readonly group?: string } };

const describedOf = (dir: string): Described => JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as Described;

/** A description's details, after its head: what the server does, since the row's link already names what it serves. */
const detailsOf = (description: string): string => {
  const colon = description.indexOf(": ");
  const details = colon === -1 ? description : description.slice(colon + 2);
  return `${details.charAt(0).toUpperCase()}${details.slice(1)}`.replace(/\|/g, "\\|");
};

/** How many tools a server's README lists, and the most a call to one can do. */
const reachOf = (dir: string): string => {
  const classes = [...accessOf(readFileSync(join(ROOT, dir, "README.md"), "utf8")).values()];
  const reach = classes.includes("money") ? "including **money**" : classes.includes("write") ? "read and write" : "read-only";
  return `${classes.length} tools, ${reach}`;
};

/**
 * The root README's tables, from each workspace's package.json: the servers by
 * group, each with its icon, its title, what it does and how far its tools
 * reach (from its README's tool tables, which check-docs holds to the code),
 * then the shared packages.
 */
const serversTable = (): { readonly table: string; readonly problems: readonly string[] } => {
  const dirs = (parent: string) => readdirSync(join(ROOT, parent)).sort().map((name) => `${parent}/${name}`);
  const servers = dirs("servers").map((dir) => ({ dir, pkg: describedOf(dir) }));
  const problems = servers.filter(({ pkg }) => !GROUPS.includes(pkg.mcp?.group ?? "")).map(({ dir }) => `${dir}: package.json's mcp.group must be one of ${GROUPS.join(", ")}`);
  // Two columns, so a phone keeps room for the description: the tool count sits under the name.
  // The icon sits inside the server's link: GitHub links a bare image to its own file, a link
  // with no name for a screen reader when the image is decorative.
  const row = ({ dir, pkg }: { readonly dir: string; readonly pkg: Described }): string =>
    `| [<img src="${dir}/icons/icon.svg" width="20" height="20" alt=""> ${pkg.mcp?.title ?? dir}](${dir})<br><sub>${reachOf(dir)}</sub> | ${detailsOf(pkg.description)} |`;
  const groups = GROUPS.flatMap((group) => {
    const members = servers.filter(({ pkg }) => pkg.mcp?.group === group);
    return members.length === 0 ? [] : [`### ${group}`, "", "| Server | What it does |", "|---|---|", ...members.map(row), ""];
  });
  const packages = dirs("packages").map((dir) => `| [${dir.split("/")[1]}](${dir}) | ${detailsOf(describedOf(dir).description)} |`);
  return { table: [...groups, "### Shared packages", "", "| Package | What it is |", "|---|---|", ...packages].join("\n"), problems };
};

/** The root README's generated block: a problem, or none (rewritten under --write). */
const checkRootReadme = (write: boolean): readonly string[] => {
  const path = join(ROOT, "README.md");
  const original = readFileSync(path, "utf8");
  const begin = original.indexOf(SERVERS_BEGIN);
  const end = original.indexOf(SERVERS_END);
  if (begin === -1 || end < begin) return [`README.md: no ${SERVERS_BEGIN} ... ${SERVERS_END} block for the table of servers`];
  const { table, problems } = serversTable();
  if (problems.length > 0) return problems;
  const updated = `${original.slice(0, begin + SERVERS_BEGIN.length)}\n${table}\n${original.slice(end)}`;
  if (updated === original) return [];
  if (write) {
    writeFileSync(path, updated);
    return [];
  }
  return ["README.md: the table of servers is out of date (npx tsx scripts/check-docs.ts --write)"];
};

const main = async (): Promise<void> => {
  const configuration = readFileSync(join(ROOT, "docs/configuration.md"), "utf8");
  const shared = documentedIn(configuration);
  const problems: string[] = [];
  for (const dir of ["packages/mcp-kit", "packages/receipts"]) {
    if (!existsSync(join(ROOT, dir, "CHANGELOG.md"))) problems.push(`${dir}: has no CHANGELOG.md (.changeset/README.md)`);
    for (const variable of envReadIn(join(ROOT, dir, "src"))) {
      if (!shared.has(variable) && !PLATFORM.has(variable)) problems.push(`${dir}: reads \`${variable}\`, which docs/configuration.md does not document`);
    }
  }
  const write = process.argv.includes("--write");
  const asked = process.argv.slice(2).filter((a) => a !== "--write");
  if (asked.length === 0) problems.push(...checkRootReadme(write));
  const servers = asked.length > 0 ? asked : readdirSync(join(ROOT, "servers")).sort();
  for (const server of servers) {
    problems.push(...(await checkServer(server, shared, write)).map((p) => `servers/${server}: ${p}`));
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\ncheck-docs: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.error(`check-docs: ${servers.length} servers, docs match the code`);
};

await main();
