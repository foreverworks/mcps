import { dirname, resolve } from "node:path";

import { readConfigFile, unsetPath } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../domain/errors.js";

/** One base for sandbox and production; the application_id decides which it is. */
export const API_BASE = "https://api.enablebanking.com";

export type AppConfig = {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly environment: string;
  readonly redirectUrl: string;
  readonly privateKeyPath: string;
  readonly apiBase: string;
};

const nonBlank = z.string().trim().min(1);

/**
 * app.json, as far as this server reads it. The file is the Enable Banking
 * control panel's export plus `private_key` (and `public_cert`, which this
 * server does not read), so unknown keys are ignored rather than refused. It is
 * never written: other programs may read the same file.
 */
const AppJson = z.object({
  application_id: nonBlank,
  redirect_url: nonBlank,
  private_key: nonBlank.optional(),
  application_name: nonBlank.optional(),
  environment: nonBlank.optional(),
  api_base: nonBlank.optional(),
});

/**
 * @param path ENABLE_BANKING_CONFIG, which has no default.
 * @param keyOverride ENABLE_BANKING_KEY: when set it names the key verbatim and
 *   app.json's `private_key` is not consulted at all. Otherwise a relative
 *   `private_key` resolves against app.json's own directory, so the pair
 *   travels together.
 */
export const loadConfig = async (path: string | undefined, keyOverride?: string): Promise<AppConfig> => {
  if (path === undefined) return fail(configError(unsetPath("ENABLE_BANKING_CONFIG")));
  const app = await readConfigFile(path, AppJson, (message) => fail(configError(message)));
  const keyPath =
    keyOverride ??
    (app.private_key === undefined
      ? fail(configError(`app config at ${path} names no private_key, and ENABLE_BANKING_KEY is not set`))
      : resolve(dirname(path), app.private_key));
  return {
    applicationId: app.application_id,
    applicationName: app.application_name ?? "enable-banking",
    environment: app.environment ?? "sandbox",
    redirectUrl: app.redirect_url,
    privateKeyPath: keyPath,
    apiBase: app.api_base ?? API_BASE,
  };
};
