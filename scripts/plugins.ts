/**
 * Writes and checks the plugin folders: each server that is published (its
 * audience ships and its package.json is no longer private, as
 * scripts/release.ts decides) as a plugin for Claude and for Cursor under
 * plugins/<server>/, and the repository's marketplace for each at its root.
 * Every file is derived from the server's package.json, its README's tool
 * tables, its icon and the repository's LICENSE (scripts/plugins/), so the
 * folders are never edited by hand: a version bump, a new setting or a new
 * tagline is one `--write` away, and `npm run check` fails while what is on
 * disk differs from what this would write, or plugins/ holds anything else.
 *
 * A plugin folder holds:
 *   .claude-plugin/plugin.json    Claude's manifest, with the listing's links and a userConfig option per input
 *   .mcp.json                     the server, started with npx at the package's exact version
 *   .cursor-plugin/plugin.json    Cursor's manifest, with a variable per input
 *   mcp.json                      the same server for Cursor
 *   README.md, LICENSE            what the listing shows, and the licence
 *   assets/icon.png               the server's icon
 *
 * Each plugin is also held to the blocking rules of Claude's directory that
 * a file can break (https://claude.com/docs/plugins/pre-submission-checklist):
 * a README of 40 words or more, no file over 256 KiB but an image, no
 * package-manager configuration, npx pinned to an exact version.
 *
 *   npx tsx scripts/plugins.ts [--write]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { jsonText, publisherOf, readManifest, shipsOf, type Manifest } from "./packaging.js";
import { claudeMarketplace, claudeMcp, claudePlugin, cursorMarketplace, cursorMcp, cursorPlugin, ICON, marketplaceOf, pinnedCommand, PLUGINS_DIR } from "./plugins/manifests.js";
import { pluginReadme, wordsOf } from "./plugins/readme.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A file the plugins consist of: its path from the repository's root, and its content. */
export type File = { readonly path: string; readonly content: string | Buffer };

/** A server that gets a plugin, with what its plugin is made from. */
export type Source = { readonly manifest: Manifest; readonly readme: string; readonly icon: Buffer };

/** The marketplace files, at the repository's root. */
export const MARKETPLACES = [".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json"] as const;

/** Whether a server gets a plugin: it is published, so the package its plugin starts exists on npm. */
export const listedOf = (m: Manifest): boolean => shipsOf(m) && !m.private;

/** Every file of the plugins and the marketplaces, from the sources. */
export const pluginFiles = (sources: readonly Source[], license: string, repository: { readonly url: string; readonly description: string }): readonly File[] => {
  const manifests = sources.map((s) => s.manifest);
  const publisher = publisherOf(manifests);
  const market = marketplaceOf(repository.url, repository.description, publisher);
  const plugin = ({ manifest: m, readme, icon }: Source): readonly File[] => {
    const at = (path: string): string => `${PLUGINS_DIR}/${m.server}/${path}`;
    return [
      { path: at(".claude-plugin/plugin.json"), content: jsonText(claudePlugin(m, publisher)) },
      { path: at(".mcp.json"), content: jsonText(claudeMcp(m)) },
      { path: at(".cursor-plugin/plugin.json"), content: jsonText(cursorPlugin(m, publisher)) },
      { path: at("mcp.json"), content: jsonText(cursorMcp(m)) },
      { path: at("README.md"), content: pluginReadme(m, readme, market) },
      { path: at("LICENSE"), content: license },
      { path: at(ICON), content: icon },
    ];
  };
  const [claude, cursor] = MARKETPLACES;
  return [
    ...sources.flatMap(plugin),
    { path: claude, content: jsonText(claudeMarketplace(market, manifests)) },
    { path: cursor, content: jsonText(cursorMarketplace(market, manifests)) },
  ];
};

const KIB = 1024;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const PACKAGE_CONFIG = new Set([".npmrc", ".yarnrc", ".yarnrc.yml", "bunfig.toml", "uv.toml", "pip.conf"]);
const EXACT = /@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** What Claude's directory would block a plugin for, among the rules its files can break. */
export const submissionProblems = (files: readonly File[], sources: readonly Source[]): readonly string[] => [
  ...files.flatMap(({ path, content }) => [
    ...(!IMAGE.test(path) && Buffer.byteLength(content) >= 256 * KIB ? [`${path} is ${Math.round(Buffer.byteLength(content) / KIB)} KiB; Claude's directory holds a file of 256 KiB or more`] : []),
    ...(PACKAGE_CONFIG.has(path.split("/").pop() ?? "") ? [`${path} sets a package source, which Claude's directory refuses beside npx`] : []),
    ...(path.endsWith("/README.md") && wordsOf(String(content)) < 40 ? [`${path} has ${wordsOf(String(content))} words outside code; Claude's directory wants 40`] : []),
  ]),
  ...sources.flatMap(({ manifest: m }) => {
    const pinned = pinnedCommand(m).args.at(-1) ?? "";
    return EXACT.test(pinned) ? [] : [`plugins/${m.server}: npx runs ${pinned}, not an exact version`];
  }),
];

/** Every file under a folder, as paths from the repository's root. */
const filesUnder = (dir: string): readonly string[] =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : [path];
      })
    : [];

/** The servers that get a plugin, read from disk, or the problems that keep one from being read. */
const readSources = (): { readonly sources: readonly Source[]; readonly problems: readonly string[] } => {
  const read = readdirSync(join(ROOT, "servers"))
    .sort()
    .map((server) => ({ server, ...readManifest(ROOT, server) }));
  const problems = read.flatMap((r) => r.problems.map((p) => `servers/${r.server}: ${p} (npx tsx scripts/check-docs.ts says more)`));
  const sources = read
    .flatMap((r) => (r.manifest !== undefined && listedOf(r.manifest) ? [r.manifest] : []))
    .map((manifest) => ({
      manifest,
      readme: readFileSync(join(ROOT, manifest.repository.directory, "README.md"), "utf8"),
      icon: readFileSync(join(ROOT, manifest.repository.directory, "icons", "icon-512.png")),
    }));
  return { sources, problems };
};

const same = (path: string, content: string | Buffer): boolean => existsSync(join(ROOT, path)) && readFileSync(join(ROOT, path)).equals(Buffer.from(content));

const main = (): void => {
  const write = process.argv.includes("--write");
  const { sources, problems: unread } = readSources();
  if (unread.length > 0) {
    console.error(unread.join("\n"));
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { readonly description: string; readonly repository: { readonly url: string } };
  const files = pluginFiles(sources, readFileSync(join(ROOT, "LICENSE"), "utf8"), { url: pkg.repository.url, description: pkg.description });
  const problems = [...submissionProblems(files, sources)];
  const wanted = new Set(files.map((f) => f.path));
  const stale = files.filter((f) => !same(f.path, f.content));
  const stray = filesUnder(PLUGINS_DIR).filter((path) => !wanted.has(path));
  if (write) {
    for (const { path, content } of stale) {
      mkdirSync(dirname(join(ROOT, path)), { recursive: true });
      writeFileSync(join(ROOT, path), content);
    }
    for (const path of stray) rmSync(join(ROOT, path));
    for (const dir of new Set(stray.map((path) => path.split("/").slice(0, 2).join("/")))) {
      if (filesUnder(dir).length === 0) rmSync(join(ROOT, dir), { recursive: true, force: true });
    }
  } else {
    problems.push(
      ...stale.map((f) => `${f.path} is ${existsSync(join(ROOT, f.path)) ? "out of date" : "missing"} (npx tsx scripts/plugins.ts --write)`),
      ...stray.map((path) => `${path} is not a file a plugin is made of (npx tsx scripts/plugins.ts --write deletes it)`),
    );
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\nplugins: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.error(`plugins: ${sources.length} plugins${write && stale.length + stray.length > 0 ? `, ${stale.length} file(s) written, ${stray.length} deleted` : ", every file as the package.json files make it"}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
