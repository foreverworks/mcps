/**
 * Publishes what a release should: every workspace whose package.json is no
 * longer `"private": true` and whose version npm does not have yet, the
 * toolkit first, with provenance; then each such server's registry entry
 * (`server.json`) to the official MCP Registry, which checks the npm package's
 * `mcpName` and so needs the npm version to exist first. Run by
 * .github/workflows/release.yml; docs/releasing.md is the procedure.
 *
 *   npx tsx scripts/release.ts plan      what would be published, nothing sent
 *   npx tsx scripts/release.ts rehearse  the plan, npm's dry run of each publish and a
 *                                        registry login, nothing sent (CI, by hand)
 *   npx tsx scripts/release.ts publish   publish it (CI only)
 *   npx tsx scripts/release.ts trust     make each published package trust the release
 *                                        workflow (a maintainer, signed in to npm)
 *
 * It can be run again after a failure: a version npm or the registry already
 * has is skipped, never sent twice.
 *
 * The registry entry is published with DNS authentication for the namespace
 * (com.foreverworks): MCP_REGISTRY_PRIVATE_KEY holds the hex Ed25519 seed whose
 * public half is the TXT record on foreverworks.com. A registry login lasts
 * five minutes, so it logs in again before each entry.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NAMESPACE } from "./packaging.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTRY = "https://registry.modelcontextprotocol.io";
const DOMAIN = NAMESPACE.split(".").reverse().join(".");

type Workspace = {
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly internal: readonly string[];
  readonly mcpName?: string;
};

const readWorkspace = (dir: string): Workspace => {
  const pkg = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly private?: boolean;
    readonly mcpName?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
  };
  return {
    dir,
    name: pkg.name,
    version: pkg.version,
    private: pkg.private === true,
    internal: Object.keys(pkg.dependencies ?? {}).filter((dep) => dep.startsWith("@foreverworks/")),
    ...(pkg.mcpName === undefined ? {} : { mcpName: pkg.mcpName }),
  };
};

/** The toolkit packages first, then the servers: a server depends on them by version range. */
const workspaces = (): readonly Workspace[] =>
  ["packages", "servers"].flatMap((parent) =>
    readdirSync(join(ROOT, parent))
      .sort()
      .map((name) => readWorkspace(`${parent}/${name}`)),
  );

const onNpm = (w: Workspace): boolean => {
  const found = spawnSync("npm", ["view", `${w.name}@${w.version}`, "version"], { cwd: ROOT, encoding: "utf8" });
  return found.status === 0 && found.stdout.trim() === w.version;
};

const inRegistry = async (w: Workspace): Promise<boolean> => {
  const answer = await fetch(`${REGISTRY}/v0.1/servers/${encodeURIComponent(w.mcpName ?? "")}/versions/${encodeURIComponent(w.version)}`);
  if (answer.status === 404) return false;
  if (answer.ok) return true;
  throw new Error(`the registry answered ${answer.status} for ${w.mcpName}@${w.version}`);
};

/** Runs a command in the repository; `shown` is what the log prints instead of a secret argument. */
const run = (command: string, args: readonly string[], shown: readonly string[] = args): void => {
  console.log(`$ ${command} ${shown.join(" ")}`);
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
};

/** A public package that depends on a private one could not be installed. */
const unpublishable = (all: readonly Workspace[]): readonly string[] => {
  const byName = new Map(all.map((w) => [w.name, w]));
  return all.flatMap((w) =>
    w.private ? [] : w.internal.filter((dep) => byName.get(dep)?.private !== false).map((dep) => `${w.name} is public but depends on ${dep}, which is still private`),
  );
};

/** The workflow, repository and environment npm's trusted publisher names: release.yml's own. */
const WORKFLOW = "release.yml";
const ENVIRONMENT = "release";
/** `npm trust` needs this npm or newer. */
const NPM_TRUST = [11, 15, 0] as const;

const repository = (): string => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { readonly repository: { readonly url: string } };
  const slug = /github\.com\/([^/]+\/[^/.]+)/.exec(pkg.repository.url)?.[1];
  if (slug === undefined) throw new Error(`package.json's repository is not on GitHub: ${pkg.repository.url}`);
  return slug;
};

const npmIsAtLeast = (wanted: readonly number[]): boolean => {
  const have = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim().split(".").map(Number);
  for (const [i, part] of wanted.entries()) {
    if ((have[i] ?? 0) !== part) return (have[i] ?? 0) > part;
  }
  return true;
};

/**
 * Connects each published package to the release workflow, once per package;
 * a package that already names the workflow is left alone. npm asks for the
 * maintainer's second factor, so this runs on their machine, never in CI.
 */
const trust = (shipping: readonly Workspace[], dryRun: boolean): void => {
  if (!npmIsAtLeast(NPM_TRUST)) throw new Error(`npm trust needs npm ${NPM_TRUST.join(".")} or newer: npm install -g npm@latest`);
  const repo = repository();
  for (const w of shipping) {
    if (!onNpm(w)) {
      console.log(`${w.name}: not on npm yet, so it cannot trust a workflow; publish it first`);
      continue;
    }
    const listed = spawnSync("npm", ["trust", "list", w.name, "--json"], { cwd: ROOT, encoding: "utf8" });
    if (listed.status === 0 && listed.stdout.includes(WORKFLOW)) {
      console.log(`${w.name}: already trusts ${WORKFLOW}`);
      continue;
    }
    run("npm", ["trust", "github", w.name, "--file", WORKFLOW, "--repo", repo, "--env", ENVIRONMENT, "--allow-publish", "--yes", ...(dryRun ? ["--dry-run"] : [])]);
  }
};

const MODES = ["plan", "rehearse", "publish", "trust"] as const;
type Mode = (typeof MODES)[number];

const isMode = (value: string | undefined): value is Mode => MODES.some((m) => m === value);

const loginToRegistry = (key: string): void => {
  if (key === "") throw new Error("MCP_REGISTRY_PRIVATE_KEY is not set: the registry entries need the namespace's key (docs/releasing.md)");
  const login = ["login", "dns", "--domain", DOMAIN, "--private-key"];
  run("mcp-publisher", [...login, key], [...login, "***"]);
};

const main = async (): Promise<void> => {
  const mode = process.argv[2];
  if (!isMode(mode)) {
    console.error(`usage: npx tsx scripts/release.ts ${MODES.join("|")}`);
    process.exit(2);
  }
  const all = workspaces();
  const blocked = unpublishable(all);
  if (blocked.length > 0) {
    console.error(blocked.join("\n"));
    process.exit(1);
  }
  const shipping = all.filter((w) => !w.private);
  if (mode === "trust") {
    trust(shipping, process.argv.includes("--dry-run"));
    return;
  }
  const key = process.env["MCP_REGISTRY_PRIVATE_KEY"]?.trim() ?? "";
  // The key and the namespace's DNS record, proved before a release needs them.
  if (mode === "rehearse") loginToRegistry(key);
  for (const w of all.filter((w) => w.private)) console.log(`${w.name}: private, not published`);
  if (shipping.length === 0) {
    console.log("nothing to publish: every package is private (removing that flag is the decision to publish it)");
    return;
  }
  for (const w of shipping) {
    if (onNpm(w)) console.log(`${w.name}@${w.version}: already on npm`);
    else if (mode === "plan") console.log(`${w.name}@${w.version}: would be published to npm`);
    else run("npm", ["publish", "-w", w.dir, "--access", "public", ...(mode === "rehearse" ? ["--dry-run"] : ["--provenance"])]);
  }
  for (const w of shipping.filter((w) => w.mcpName !== undefined)) {
    if (await inRegistry(w)) {
      console.log(`${w.mcpName}@${w.version}: already in the MCP Registry`);
      continue;
    }
    if (mode !== "publish") {
      console.log(`${w.mcpName}@${w.version}: would be published to the MCP Registry`);
      continue;
    }
    loginToRegistry(key);
    run("mcp-publisher", ["publish", join(w.dir, "server.json")]);
  }
};

await main();
