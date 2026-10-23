import { readSecret } from "@foreverworks/mcp-kit";

import { configError, fail, TSDR_SOURCE } from "../../domain/errors.js";

/** From a file first (for a service, its credentials directory), else the variable, for a local run. */
const KEY = { file: "USPTO_TSDR_API_KEY_FILE", value: "USPTO_TSDR_API_KEY" } as const;

export const loadTsdrKey = async (env: NodeJS.ProcessEnv): Promise<string> =>
  (await readSecret(env, KEY, (message) => fail(configError(TSDR_SOURCE, message)))) ??
  fail(configError(TSDR_SOURCE, `USPTO's TSDR API is not configured: neither ${KEY.file} nor ${KEY.value} is set`));
