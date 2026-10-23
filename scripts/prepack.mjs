// npm packs a workspace from its own folder, and a package carries only the LICENSE beside its
// package.json. The repo has one LICENSE; this copies it in for the pack (the copy is gitignored).
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

copyFileSync(fileURLToPath(new URL("../LICENSE", import.meta.url)), "LICENSE");
