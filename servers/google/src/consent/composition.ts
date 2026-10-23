import { envPath } from "@foreverworks/mcp-kit";

import { saveCredentials } from "../infra/credentials.js";
import { googleStateDir } from "../infra/locations.js";
import type { Deps } from "./app/ports.js";
import { AUTH_URI, DEFAULT_REDIRECT_URI, exchangeCode, whoApproved } from "./infra/google.js";
import { makePendingStore } from "./infra/pendingStore.js";
import { type Directory, makeTargets } from "./infra/targets.js";

/**
 * The composition root for consent: the only module naming its ports and
 * their implementations. Waiting consents are kept in the server's own state
 * directory (GOOGLE_STATE_DIR); the client new grants are made on is
 * GOOGLE_OAUTH_CLIENT_FILE's when it is set.
 */
export const buildConsent = (env: NodeJS.ProcessEnv, directory: Omit<Directory, "oauthClient">): Deps => ({
  target: makeTargets({ ...directory, oauthClient: envPath(env, "GOOGLE_OAUTH_CLIENT_FILE") }),
  pending: makePendingStore(googleStateDir(env)),
  exchange: exchangeCode,
  whoApproved,
  save: saveCredentials,
  authUri: AUTH_URI,
  redirectUri: env["GOOGLE_CONSENT_REDIRECT_URI"]?.trim() || DEFAULT_REDIRECT_URI,
  now: () => Date.now(),
});
