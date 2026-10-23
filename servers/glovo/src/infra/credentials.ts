import { credentialsReader } from "@foreverworks/receipts/infra";

/**
 * `{"refresh_token": "...", "device_urn": "glv:device:<uuid>"}`, both read from
 * the logged-in web app's localStorage (README.md has the console snippet). The
 * device urn is not decoration: every call names it, refresh included.
 */
export const loadCredentials = credentialsReader({ refreshToken: "refresh_token", deviceUrn: "device_urn" });

export type Credentials = Awaited<ReturnType<typeof loadCredentials>>;
