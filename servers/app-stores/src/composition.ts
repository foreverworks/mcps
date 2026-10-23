import { once } from "@foreverworks/mcp-kit";

import type { Deps } from "./app/ports.js";
import { makeAppStore } from "./infra/appStore.js";
import { loadAscKey, loadServiceAccount } from "./infra/credentials.js";
import type { StoreHttpOptions } from "./infra/http.js";
import type { ClockOptions } from "./infra/jwt.js";
import { makeOutbox } from "./infra/outbox.js";
import { makePlay } from "./infra/play.js";

/**
 * The composition root: the only module naming both a port and what
 * implements it. Credentials are read by the first call that needs them and
 * kept; a failed read is tried again on the next call, so the server starts,
 * lists its tools and answers health without any.
 *
 * Settings, from the environment only: ASC_KEY_ID, ASC_ISSUER_ID and
 * ASC_PRIVATE_KEY_FILE (or ASC_PRIVATE_KEY) for App Store Connect;
 * PLAY_SERVICE_ACCOUNT_FILE (or PLAY_SERVICE_ACCOUNT) and PLAY_PACKAGES for
 * Google Play; APP_STORES_OUTBOX_DIR or APP_STORES_STATE_DIR for crash logs.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, options: StoreHttpOptions & ClockOptions = {}): Deps => {
  const retrying = <T>(load: () => Promise<T>): (() => Promise<T>) => {
    let held = once(load);
    return () =>
      held().catch((thrown: unknown) => {
        held = once(load);
        throw thrown;
      });
  };
  const packages = (env["PLAY_PACKAGES"] ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
  return {
    appStore: makeAppStore(retrying(() => loadAscKey(env)), options),
    play: makePlay(retrying(() => loadServiceAccount(env)), options),
    packages,
    outbox: makeOutbox(env),
  };
};
