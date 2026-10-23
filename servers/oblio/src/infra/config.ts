import { readConfigFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { configError, fail } from "../domain/errors.js";

export const API_BASE = "https://www.oblio.eu/api";
export const TOKEN_URL = "https://www.oblio.eu/api/authorize/token";

export type AppConfig = {
  /** The Oblio account's login email. Oblio calls it client_id; it is not a secret. */
  readonly clientId: string;
  /** From Settings, Account Data in the Oblio web app. Regenerated on every password reset. */
  readonly clientSecret: string;
  /** The company every call acts on behalf of. */
  readonly companyCif: string;
  readonly apiBase: string;
  readonly tokenUrl: string;
};

/**
 * app.json. `company_cif` is required rather than defaulted: a default would
 * mean issuing invoices against whichever company happened to be baked into
 * the source. `api_base` and `token_url` exist for tests and an outage proxy.
 */
const appJson = z.object({
  client_id: z.string().trim().min(1),
  client_secret: z.string().trim().min(1),
  company_cif: z.string().trim().min(1),
  api_base: z.url().optional(),
  token_url: z.url().optional(),
});

/**
 * Read app.json, which this server never writes: under systemd it sits in the
 * unit's credentials directory, which is read-only. Problems are
 * named by FIELD, never by value, because one of the values is the secret
 * (the kit's readConfigFile).
 */
export const loadConfig = async (path: string | undefined): Promise<AppConfig> => {
  if (path === undefined)
    return fail(
      configError(
        "no app.json: set OBLIO_CONFIG to its path, or run under systemd with LoadCredential=app.json",
      ),
    );
  const app = await readConfigFile(path, appJson, (message) => fail(configError(message)));
  return {
    clientId: app.client_id,
    clientSecret: app.client_secret,
    companyCif: app.company_cif,
    apiBase: app.api_base ?? API_BASE,
    tokenUrl: app.token_url ?? TOKEN_URL,
  };
};
