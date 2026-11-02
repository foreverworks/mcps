import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonFile } from "@foreverworks/mcp-kit";

import type { Registries } from "../composition.js";
import { beginConsent, completeConsent } from "../consent/app/consent.js";
import { asAppError } from "../consent/domain/errors.js";
import { googleStateDir, OAUTH_CLIENT_FILE, oauthClientOf } from "../infra/locations.js";
import type { Ports, Terminal } from "./app/ports.js";
import { checkClientFile } from "./domain/clientFile.js";
import { carriedVariables } from "./domain/plan.js";
import { listenOnLoopback } from "./infra/loopback.js";
import { findGcloud, keepClientFile, openUrl, watchForClient } from "./infra/system.js";

/**
 * The composition root for setup: the only module naming its ports and their
 * implementations. Consent goes through the server's own use cases on the
 * registries the server runs on, with the redirect pointed at setup's loopback
 * listener, so a grant setup makes is checked and saved exactly as one made
 * through begin_consent, in the file the product reads.
 */
export const buildSetup = (env: NodeJS.ProcessEnv, registries: Registries, terminal: Terminal): Ports => {
  const consent = registries.consent;
  const stateDir = googleStateDir(env);
  return {
    terminal,
    open: openUrl,
    gcloud: findGcloud,
    stateDir,
    downloadsDir: join(env["HOME"]?.trim() || homedir(), "Downloads"),
    existingClient: async () => {
      const source = oauthClientOf(env);
      if (!source) return undefined;
      const checked = checkClientFile(await readJsonFile(source.path));
      return { ...source, ...("ok" in checked && checked.ok.projectId ? { projectId: checked.ok.projectId } : {}) };
    },
    watchForClient,
    readJson: (path) => readJsonFile(path),
    // GOOGLE_OAUTH_CLIENT_FILE, when set, is where the server reads the client, so that is where it goes.
    keepClient: keepClientFile(oauthClientOf(env)?.from === "GOOGLE_OAUTH_CLIENT_FILE" ? (oauthClientOf(env)?.path ?? "") : join(stateDir, OAUTH_CLIENT_FILE)),
    listen: listenOnLoopback,
    existingGrant: async (product, account) => {
      const path = (await consent.target(product, account)).credentialsPath;
      return existsSync(path) ? path : undefined;
    },
    begin: (product, account, redirectUri) => beginConsent({ ...consent, redirectUri }, { product, account, learn: true }),
    complete: async (redirectUrl) => {
      const done = await completeConsent(consent, { redirectUrl });
      return { address: done.address, path: done.path };
    },
    describe: (thrown) => {
      const error = asAppError(thrown);
      if (error) return error.message;
      return thrown instanceof Error ? thrown.message : String(thrown);
    },
    carried: carriedVariables(env),
    now: () => Date.now(),
  };
};
