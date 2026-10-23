import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The one test configuration every workspace uses (`vitest.config.ts` re-exports it).
 *
 * - `isolate.ts` runs before every test file: HOME is an empty temp dir, every credential and state
 *   variable is unset, and fetch refuses anything but loopback unless a test stubs it, so no test
 *   reaches a real grant or the network.
 * - `unstubGlobals`: a fetch one test stubs is gone before the next, which gets the refusing one back.
 */
export default defineConfig({
  test: {
    setupFiles: [fileURLToPath(new URL("./isolate.ts", import.meta.url))],
    unstubGlobals: true,
  },
});
