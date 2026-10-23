// Run as a workspace's prebuild: tsc writes into dist/ but never removes what an earlier layout left
// there, and npm pack ships everything under dist/. A long-lived checkout once carried compiled
// files of modules deleted months before. So the build starts from nothing.
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
