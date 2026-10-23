/**
 * The tools whose access class changed since the last release, and whether
 * each change is told to the people upgrading. A person reads a changelog for
 * what changed; that a tool now moves money, or now writes, matters most.
 *
 * The record is each server's README tool tables, which check-docs holds to
 * the code. The base is the newest `release-*` tag (or `--since <ref>`). A
 * change is told when a pending changeset for the package, or the lines its
 * CHANGELOG.md gained since the base, name the tool in backticks. A tool that
 * is new as `read` needs nothing; a new `write` or `money` tool, a removed one,
 * and any change of class each need their sentence.
 *
 * Needs git, so it runs in CI and in the release, not in `npm run check`
 * (whose release build has no repository).
 *
 *   npx tsx scripts/access-changes.ts [--check] [--since <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { accessOf, changesBetween, describeChange, names } from "./readme.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const git = (args: readonly string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

/** A file as it was at a ref, or undefined where it did not exist. */
const showAt = (ref: string, path: string): string | undefined => {
  const shown = spawnSync("git", ["show", `${ref}:${path}`], { cwd: ROOT, encoding: "utf8" });
  return shown.status === 0 ? shown.stdout : undefined;
};

/** The pending changesets that name a package. */
const pendingFor = (pkg: string): string =>
  readdirSync(join(ROOT, ".changeset"))
    .filter((file) => file.endsWith(".md") && file !== "README.md")
    .map((file) => readFileSync(join(ROOT, ".changeset", file), "utf8"))
    .filter((text) => text.split("---")[1]?.includes(`"${pkg}"`) ?? false)
    .join("\n");

const main = (): void => {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const at = args.indexOf("--since");
  const base = at === -1 ? git(["tag", "--list", "release-*", "--sort=-creatordate"]).split("\n")[0]?.trim() : args[at + 1];
  if (base === undefined || base === "") {
    console.log("no release-* tag yet: nothing to compare (check-docs holds every money tool to its changelog meanwhile)");
    return;
  }
  const missing: string[] = [];
  for (const server of readdirSync(join(ROOT, "servers")).sort()) {
    const dir = `servers/${server}`;
    const now = readFileSync(join(ROOT, dir, "README.md"), "utf8");
    const then = showAt(base, `${dir}/README.md`) ?? "";
    const changes = changesBetween(accessOf(then), accessOf(now));
    if (changes.length === 0) continue;
    const pkg = (JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as { readonly name: string }).name;
    // The changelog's lines that were not there at the base, committed or not.
    const was = new Set((showAt(base, `${dir}/CHANGELOG.md`) ?? "").split("\n"));
    const log = existsSync(join(ROOT, dir, "CHANGELOG.md")) ? readFileSync(join(ROOT, dir, "CHANGELOG.md"), "utf8") : "";
    const added = log
      .split("\n")
      .filter((line) => !was.has(line))
      .join("\n");
    const told = `${pendingFor(pkg)}\n${added}`;
    for (const change of changes) {
      const ok = names(told, change.tool);
      console.log(`${pkg}: ${describeChange(change)}${ok ? "" : "  <- not in a changeset or the changelog"}`);
      if (!ok) missing.push(`${pkg}: ${describeChange(change)}`);
    }
  }
  if (check && missing.length > 0) {
    console.error(`\n${missing.length} access change(s) since ${base} that no changeset or changelog tells (.changeset/README.md):\n${missing.join("\n")}`);
    process.exit(1);
  }
};

main();
