import { mergeConfig } from "vitest/config";

import shared from "../../packages/mcp-kit/testing/vitest.ts";

// The shared setup empties the environment before a test file runs. test/store.pg.test.ts is opt-in and
// needs a database, so its URL is read here, in the process that starts vitest, and handed to the test
// through vitest's `provide`; the test is skipped when it is empty.
export default mergeConfig(shared, { test: { provide: { ragTestDatabaseUrl: process.env["RAG_TEST_DATABASE_URL"] ?? "" } } });
