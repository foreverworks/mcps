import { OK, TRANSIENT, type Verdict } from "@foreverworks/mcp-kit";

import { refresh } from "../app/usecases/tokens.js";
import { type BuildOptions, buildDeps } from "../composition.js";
import { days, isoOf, MAINTENANCE_WINDOW_S, REAUTHORIZE_WARNING_S } from "../domain/tokens.js";
import { failureVerdict } from "./verdict.js";

const WINDOW_DAYS = MAINTENANCE_WINDOW_S / 86_400;
const WARN_DAYS = REAUTHORIZE_WARNING_S / 86_400;

/**
 * `--refresh [--force]`: the daily maintenance job, for a timer. Refreshes
 * when the access token has less than fourteen days left, or always with
 * `--force`, under the same lock and with the same rotation rules as the
 * server itself, because it IS the server's code.
 *
 * It takes no tokens.json.bak first: a copy of a pair that is about to be
 * rotated holds a refresh token ANAF has just killed, and the write it would
 * guard against is already atomic.
 */
export const refreshVerdict = async (
  env: NodeJS.ProcessEnv,
  { force }: { readonly force: boolean },
  options: BuildOptions = {},
): Promise<Verdict> => {
  try {
    const deps = buildDeps(env, options);
    const { refreshed, accessDaysBefore, bundle } = await refresh(deps, { force, withinS: MAINTENANCE_WINDOW_S });
    const at = deps.now();
    const refreshLeft = bundle.refreshTokenExpEpoch - at;
    const summary =
      `access until ${isoOf(bundle.accessTokenExpEpoch).slice(0, 10)} (${days(bundle.accessTokenExpEpoch - at)}d), ` +
      `refresh until ${isoOf(bundle.refreshTokenExpEpoch).slice(0, 10)} (${days(refreshLeft)}d)`;
    const what = refreshed
      ? `refreshed (${force ? "forced" : `access had ${accessDaysBefore.toFixed(1)}d left`})`
      : `not due (refreshes inside ${WINDOW_DAYS} days)`;
    if (refreshLeft < REAUTHORIZE_WARNING_S)
      return { code: TRANSIENT, line: `ANAF: WARN ${what}, but the grant ends within ${WARN_DAYS} days: reauthorize (begin_authorization) -- ${summary}` };
    return { code: OK, line: `ANAF: OK ${what} -- ${summary}` };
  } catch (thrown) {
    return failureVerdict(thrown);
  }
};
