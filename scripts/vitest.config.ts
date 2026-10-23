// The repository scripts' own tests, under the same isolation as every workspace's.
import { defineConfig, mergeConfig } from "vitest/config";

import shared from "../packages/mcp-kit/testing/vitest.ts";

export default mergeConfig(shared, defineConfig({ test: { include: ["scripts/test/**/*.test.ts"] } }));
