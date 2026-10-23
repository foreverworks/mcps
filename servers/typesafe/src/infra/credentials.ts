import { readSecret } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

/** The key comes from a file first (for a service, its credentials directory), else the variable, for a local run. */
const SOURCE = { file: "TYPESAFE_API_KEY_FILE", value: "TYPESAFE_API_KEY" } as const;

export const loadApiKey = async (env: NodeJS.ProcessEnv): Promise<string> =>
  (await readSecret(env, SOURCE, (message) => fail(configError(message)))) ??
  fail(configError(`neither ${SOURCE.file} nor ${SOURCE.value} is set`));
