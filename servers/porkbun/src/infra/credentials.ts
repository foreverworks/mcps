import { readSecret, type SecretSource } from "@foreverworks/mcp-kit";

import { fail } from "../domain/errors.js";

export type KeyPair = { readonly apiKey: string; readonly secretApiKey: string };

/**
 * Where each key comes from (the kit's readSecret: a file first, else the
 * plain variable the vendor's own server reads, for a local stdio run).
 */
const SOURCES = {
  apiKey: { file: "PORKBUN_API_KEY_FILE", value: "PORKBUN_API_KEY" },
  secretApiKey: { file: "PORKBUN_SECRET_API_KEY_FILE", value: "PORKBUN_SECRET_API_KEY" },
} as const;

/**
 * One key (the kit's readSecret). Neither variable set gives "", as in the
 * vendor's own server: the documentation tools need no key, and every other
 * tool refuses at call time.
 */
const readKey = async (env: NodeJS.ProcessEnv, source: SecretSource): Promise<string> =>
  (await readSecret(env, source, (message) => fail({ kind: "config", message }))) ?? "";

export const loadKeyPair = async (env: NodeJS.ProcessEnv): Promise<KeyPair> => ({
  apiKey: await readKey(env, SOURCES.apiKey),
  secretApiKey: await readKey(env, SOURCES.secretApiKey),
});
