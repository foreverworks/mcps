/**
 * Builds a desktop bundle (`.mcpb`, modelcontextprotocol/mcpb) per server:
 * one file a person opens in Claude Desktop, which asks for the settings and
 * runs the server with its own Node. The release attaches every public
 * server's bundle; CI builds every one that ships to prove a release could.
 *
 *   npx tsx scripts/bundle.ts [--public] [--out <dir>] [server ...]
 *
 * Built servers only (npm run build first). For each one, in a scratch
 * folder: the toolkit and the server packed as npm would publish them
 * (`npm pack`), installed with their dependencies and nothing else
 * (`--omit=dev --ignore-scripts`; no dependency here needs an install
 * script, and none carries native code, so one bundle serves every
 * platform); the manifest from package.json (scripts/packaging.ts) with the
 * tool list a client shows; the icon; the LICENSE. Then the mcpb CLI checks
 * and packs it. With no server named, it bundles every server that ships
 * (its package.json `mcp.audience` is not "extras"), and `--public` skips
 * those still `"private": true`. An extras server is never bundled: naming
 * one fails.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listServer } from "./listed.js";
import { bundleFile, bundleManifest, jsonText, packedEntries, readManifest, readWorkspaces, type Manifest } from "./packaging.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOOLKIT = ["packages/mcp-kit", "packages/receipts"];

const run = (command: string, args: readonly string[], cwd: string): string => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** A workspace packed as npm would publish it; the tarball's path. */
const pack = (dir: string, into: string): string => {
  const [packed] = packedEntries<{ readonly filename: string }>(run("npm", ["pack", "--json", "--pack-destination", into, "-w", dir], ROOT));
  if (packed === undefined) throw new Error(`npm pack -w ${dir} packed nothing`);
  return join(into, packed.filename);
};

const nameOf = (dir: string): string => (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { readonly name: string }).name;

/** The first sentence of a tool's description, as a bundle lists it. */
const firstSentence = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  return end === -1 ? flat : flat.slice(0, end + 1);
};

const bundle = async (m: Manifest, out: string): Promise<string> => {
  const stage = mkdtempSync(join(tmpdir(), `mcpb-${m.server}-`));
  try {
    const tarballs = join(stage, ".tarballs");
    mkdirSync(tarballs);
    const kit = Object.fromEntries(TOOLKIT.map((dir) => [nameOf(dir), `file:${pack(dir, tarballs)}`]));
    const server = pack(`servers/${m.server}`, tarballs);
    // The toolkit is not on npm yet when a release first builds this: the overrides
    // send the server's own dependency on it to the tarball beside it.
    writeFileSync(join(stage, "package.json"), jsonText({ name: `mcp-${m.server}-bundle`, private: true, type: "module", dependencies: { [m.name]: `file:${server}` }, overrides: kit }));
    run("npm", ["install", "--omit=dev", "--ignore-scripts", "--install-links", "--no-audit", "--no-fund", "--no-package-lock"], stage);
    rmSync(tarballs, { recursive: true });
    const { tools } = await listServer(join(ROOT, "servers", m.server));
    writeFileSync(join(stage, "manifest.json"), jsonText(bundleManifest(m, tools.map((t) => ({ name: t.name, description: firstSentence(t.description ?? "") })))));
    copyFileSync(join(ROOT, "servers", m.server, "icons", "icon-512.png"), join(stage, "icon.png"));
    copyFileSync(join(ROOT, "LICENSE"), join(stage, "LICENSE"));
    run("npx", ["mcpb", "validate", join(stage, "manifest.json")], ROOT);
    const file = join(out, bundleFile(m));
    run("npx", ["mcpb", "pack", stage, file], ROOT);
    return file;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at === -1 ? join(ROOT, "bundles") : (args[at + 1] ?? "bundles"));
  const asked = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  const { workspaces, problems } = readWorkspaces(ROOT);
  if (problems.length > 0) throw new Error(problems.join("; "));
  const servers = new Map(workspaces.filter((w) => w.audience !== undefined).map((w) => [w.dir.slice("servers/".length), w]));
  const refused = asked.filter((server) => servers.get(server)?.ships !== true);
  if (refused.length > 0) {
    throw new Error(refused.map((server) => (servers.has(server) ? `servers/${server} is one of the extras, which are never bundled (its package.json mcp.audience)` : `there is no servers/${server}`)).join("; "));
  }
  mkdirSync(out, { recursive: true });
  for (const server of asked.length > 0 ? asked : [...servers].filter(([, w]) => w.ships).map(([server]) => server)) {
    if (args.includes("--public") && servers.get(server)?.private === true) {
      console.log(`servers/${server}: private, no bundle`);
      continue;
    }
    const { manifest, problems: unreadable } = readManifest(ROOT, server);
    if (manifest === undefined) throw new Error(`servers/${server}: ${unreadable.join("; ")}`);
    console.log(`${await bundle(manifest, out)}`);
  }
};

await main();
