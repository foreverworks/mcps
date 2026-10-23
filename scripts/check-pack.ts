/**
 * Holds what npm would publish to the sources: for every workspace, `npm pack
 * --dry-run` must list only package.json, README.md, CHANGELOG.md, LICENSE,
 * files under its docs/ and icons/, and dist/ files compiled from a file under
 * its src/ (a .js or .d.ts from a .ts, a .json copied as is). Anything else is a stale build output or
 * a stray file, and fails. Run by `npm run check` after the build.
 *
 * It reads the file system, not git: a release is built from an exported
 * tree (`git archive`, a tarball) that has no repository, and there the
 * sources on disk are exactly the tracked ones.
 *
 *   npx tsx scripts/check-pack.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const META = new Set(["package.json", "README.md", "CHANGELOG.md", "LICENSE"]);

const workspaces = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { workspaces: readonly string[] }).workspaces.flatMap((pattern) => {
  const [parent] = pattern.split("/*");
  return readdirSync(join(ROOT, parent as string))
    .map((name) => `${parent}/${name}`)
    .filter((dir) => statSync(join(ROOT, dir)).isDirectory());
});

const allowed = (dir: string, path: string): boolean => {
  if (META.has(path)) return true;
  if (path.startsWith("docs/") || path.startsWith("icons/")) return existsSync(join(ROOT, dir, path));
  const built = /^dist\/(.+?)\.(js|d\.ts|json)$/.exec(path);
  if (built === null) return false;
  const [, stem, ext] = built as unknown as [string, string, string];
  return existsSync(join(ROOT, dir, "src", `${stem}.${ext === "json" ? "json" : "ts"}`));
};

const packed = (name: string): readonly string[] => {
  const out = execFileSync("npm", ["pack", "--dry-run", "-w", name, "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(out) as readonly { files: readonly { path: string }[] }[])[0]?.files.map((f) => f.path) ?? [];
};

let failed = false;
for (const dir of workspaces) {
  const name = (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { name: string }).name;
  const files = packed(name);
  const stray = files.filter((path) => !allowed(dir, path));
  if (stray.length === 0) {
    console.log(`${name}: ${files.length} files, every one from the sources`);
  } else {
    failed = true;
    console.error(`${name}: ${stray.length} of ${files.length} files are not from the sources (a stale dist? run the build again):\n  ${stray.join("\n  ")}`);
  }
}
process.exit(failed ? 1 : 0);
