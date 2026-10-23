import { readSecret, type SecretSource } from "@foreverworks/mcp-kit";

import { configError, fail } from "../domain/errors.js";

export type Credentials = { readonly clientId: string; readonly clientSecret: string; readonly masterPassword: string };

/**
 * Where each secret comes from (the kit's readSecret: a file first, else the variable).
 */
const SOURCES = {
  clientId: { file: "BITWARDEN_CLIENT_ID_FILE", value: "BITWARDEN_CLIENT_ID" },
  clientSecret: { file: "BITWARDEN_CLIENT_SECRET_FILE", value: "BITWARDEN_CLIENT_SECRET" },
  masterPassword: { file: "BITWARDEN_MASTER_PASSWORD_FILE", value: "BITWARDEN_MASTER_PASSWORD" },
} as const;

/** One secret; neither the file nor the variable set is a config failure here, since every tool needs all three. */
const secret = async (env: NodeJS.ProcessEnv, source: SecretSource): Promise<string> =>
  (await readSecret(env, source, (message) => fail(configError(message)))) ??
  fail(configError(`neither ${source.file} nor ${source.value} is set`));

export const loadCredentials = async (env: NodeJS.ProcessEnv): Promise<Credentials> => ({
  clientId: await secret(env, SOURCES.clientId),
  clientSecret: await secret(env, SOURCES.clientSecret),
  masterPassword: await secret(env, SOURCES.masterPassword),
});
