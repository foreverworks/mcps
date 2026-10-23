import { readSecret } from "@foreverworks/mcp-kit";

import { configError, fail } from "../../domain/errors.js";

export const SOURCE = "euipo-api";

/** EUIPO's two environments: the sandbox holds test data, production the register. */
export const EUIPO_ENDPOINTS = {
  production: { api: "https://api.euipo.europa.eu/trademark-search", token: "https://euipo.europa.eu/cas-server-webapp/oidc/accessToken" },
  sandbox: { api: "https://api-sandbox.euipo.europa.eu/trademark-search", token: "https://auth-sandbox.euipo.europa.eu/oidc/accessToken" },
} as const;
export type EuipoEnvironment = keyof typeof EUIPO_ENDPOINTS;

export const environmentOf = (env: NodeJS.ProcessEnv): EuipoEnvironment => (env["EUIPO_ENVIRONMENT"]?.trim() === "sandbox" ? "sandbox" : "production");

export type EuipoCredentials = { readonly clientId: string; readonly clientSecret: string };

/** Each from a file first (for a service, its credentials directory), else the variable, for a local run. */
const ID = { file: "EUIPO_CLIENT_ID_FILE", value: "EUIPO_CLIENT_ID" } as const;
const SECRET = { file: "EUIPO_CLIENT_SECRET_FILE", value: "EUIPO_CLIENT_SECRET" } as const;

const read = async (env: NodeJS.ProcessEnv, source: typeof ID | typeof SECRET): Promise<string> =>
  (await readSecret(env, source, (message) => fail(configError(SOURCE, message)))) ??
  fail(configError(SOURCE, `EUIPO's API is not configured: neither ${source.file} nor ${source.value} is set`));

export const loadEuipoCredentials = async (env: NodeJS.ProcessEnv): Promise<EuipoCredentials> => ({
  clientId: await read(env, ID),
  clientSecret: await read(env, SECRET),
});
