import { credentialsReader } from "@foreverworks/receipts/infra";

/**
 * `{"refresh_token": "...", "device_id": "..."}`, both read from the logged-in
 * web app's localStorage (README.md has the console snippet). The device id is
 * not decoration: it is the id the refresh token was issued to.
 */
export const loadCredentials = credentialsReader({ refreshToken: "refresh_token", deviceId: "device_id" });

export type Credentials = Awaited<ReturnType<typeof loadCredentials>>;
