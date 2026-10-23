import { readSecret } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

/**
 * The Expo access token: from a file first (on a service, systemd's credentials
 * directory, which only the service can read), else EXPO_TOKEN, the variable
 * eas-cli itself reads, for a local stdio run. A robot user's token is the one
 * meant for a server: it belongs to the account, not to a person's login.
 */
const SOURCE = { file: "EXPO_TOKEN_FILE", value: "EXPO_TOKEN" } as const;

export const loadToken = async (env: NodeJS.ProcessEnv): Promise<string> =>
  (await readSecret(env, SOURCE, (message) => fail(configError(message)))) ?? fail(configError(`neither ${SOURCE.file} nor ${SOURCE.value} is set`));
