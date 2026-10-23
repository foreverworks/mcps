import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { writeJsonFile } from "@foreverworks/mcp-kit";

import type { ClientConfig, NewGrant } from "../domain/credentials.js";
import { configError, fail } from "../domain/errors.js";

/**
 * The standard google.oauth2 credentials JSON, read and written: the one file
 * format every grant here is kept in, whoever consented it.
 */

export type { ClientConfig, NewGrant };

export type Credentials = ClientConfig & {
  readonly refreshToken: string;
  readonly declaredScopes: readonly string[];
};

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

const parse = async (path: string): Promise<Record<string, unknown> | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const clientOf = (raw: Record<string, unknown>): ClientConfig | undefined =>
  raw["client_id"] && raw["client_secret"]
    ? { clientId: String(raw["client_id"]), clientSecret: String(raw["client_secret"]), tokenUri: String(raw["token_uri"] ?? GOOGLE_TOKEN_URI) }
    : undefined;

/** The object holding a client's fields: a credentials file's top level, or the `installed` (Desktop app) or `web` block of the client JSON Google Cloud's console downloads. */
const clientBlock = (raw: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ["installed", "web"]) {
    const block = raw[key];
    if (block !== null && typeof block === "object") return block as Record<string, unknown>;
  }
  return raw;
};

/**
 * Reads the credentials JSON. `token` and `expiry` are ignored on purpose:
 * this server refreshes on demand rather than trusting a timestamp written by
 * whoever last ran the consent flow.
 */
export const loadCredentials = async (path: string): Promise<Credentials> => {
  const raw = await parse(path);
  if (!raw) return fail(configError(`credentials at ${path} are missing or unparseable`));
  const missing = (["refresh_token", "client_id", "client_secret"] as const).filter((k) => !raw[k]);
  const client = clientOf(raw);
  if (missing.length > 0 || !client) return fail(configError(`credentials at ${path} lack: ${missing.join(", ")}`));
  return {
    ...client,
    refreshToken: String(raw["refresh_token"]),
    declaredScopes: Array.isArray(raw["scopes"]) ? (raw["scopes"] as string[]) : [],
  };
};

/**
 * The OAuth client a file carries, or undefined when the file is absent,
 * unreadable or has none: a credentials file, or the client JSON downloaded
 * from Google Cloud's console.
 */
export const readClient = async (path: string): Promise<ClientConfig | undefined> => {
  const raw = await parse(path);
  return raw ? clientOf(clientBlock(raw)) : undefined;
};

/**
 * Write a grant where the server reads it: the directory 0700, the file 0600
 * and written atomically, the file it replaces kept as `.bak` (0600), as the
 * consent scripts did. No access token is written; the server mints its own.
 */
export const saveCredentials = async (path: string, grant: NewGrant): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (await parse(path)) {
    await copyFile(path, `${path}.bak`);
    await chmod(`${path}.bak`, 0o600);
  }
  await writeJsonFile(
    path,
    {
      refresh_token: grant.refreshToken,
      client_id: grant.client.clientId,
      client_secret: grant.client.clientSecret,
      token_uri: grant.client.tokenUri,
      scopes: grant.scopes,
      account: grant.account,
    },
    { mode: 0o600 },
  );
};
