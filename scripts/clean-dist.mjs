// Run as a workspace's prebuild: tsc writes into dist/ but never removes what an earlier layout left
// there, and npm pack ships everything under dist/. A long-lived checkout would otherwise keep
// compiled files of modules that were deleted. So the build starts from nothing.
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
