import type { CredentialsFile } from "@foreverworks/receipts/app";
import { credentialsReader } from "@foreverworks/receipts/infra";

/**
 * A value that is a JSON string literal (`"abc"`, quotes included) as the text it holds. The web
 * app keeps `glovo_refresh_token` in localStorage JSON-encoded, so reading it raw in the console
 * copies the quotes too, and Glovo answers a quoted token with 400 `bad_request`. Anything else,
 * including a quoted value that does not parse as a JSON string, is returned unchanged.
 */
export const unwrapJsonString = (value: string): string => {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
};

/**
 * `{"refresh_token": "...", "device_urn": "glv:device:<uuid>"}`, both read from
 * the logged-in web app's localStorage (README.md has the console snippet). The
 * device urn is not decoration: every call names it, refresh included. A refresh
 * token copied with its JSON quotes is unwrapped, so an existing file keeps working.
 */
const readCredentials = credentialsReader({ refreshToken: "refresh_token", deviceUrn: "device_urn" });

export type Credentials = Awaited<ReturnType<typeof readCredentials>>;

export const loadCredentials = async (file: CredentialsFile): Promise<Credentials> => {
  const credentials = await readCredentials(file);
  return { ...credentials, refreshToken: unwrapJsonString(credentials.refreshToken) };
};
