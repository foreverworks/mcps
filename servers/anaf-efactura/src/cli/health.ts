import { OK, TRANSIENT, type Verdict } from "@foreverworks/mcp-kit";

import { checkHealth } from "../app/usecases/health.js";
import { type BuildOptions, buildDeps } from "../composition.js";
import { REAUTHORIZE_WARNING_S } from "../domain/tokens.js";
import { failureVerdict } from "./verdict.js";

const WARN_DAYS = REAUTHORIZE_WARNING_S / 86_400;

/**
 * `--health`: is the grant alive right now (HELLO), and will it still be alive
 * next week. Warns a fortnight before the refresh token runs out, because
 * recovery is a person at a browser with a certificate in a card reader.
 */
export const healthVerdict = async (env: NodeJS.ProcessEnv, options: BuildOptions = {}): Promise<Verdict> => {
  try {
    const h = await checkHealth(buildDeps(env, options));
    const summary =
      `app=${h.appName} cif=${h.defaultCif ?? "unset"} roles=${h.roles ?? "?"} ` +
      `access=${h.accessTokenRemainingDays}d refresh=${h.refreshTokenRemainingDays}d`;
    if (h.refreshTokenRemainingDays < WARN_DAYS)
      return { code: TRANSIENT, line: `ANAF: WARN reauthorization due within ${WARN_DAYS} days (begin_authorization) -- ${summary}` };
    return { code: OK, line: `ANAF: OK ${summary}` };
  } catch (thrown) {
    return failureVerdict(thrown);
  }
};
