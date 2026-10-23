import { OK, PERMANENT, verdictOf } from "@foreverworks/mcp-kit";

import { checkHealth } from "../drive/app/usecases/health.js";
import { buildDeps } from "../drive/composition.js";
import { asAppError, remedyFor } from "../drive/domain/errors.js";
import { needsHuman } from "../domain/errors.js";

/**
 * Drive's part of the shell-callable health check. One `DRIVE:` line, because
 * that prefix is how a scheduled check tells a verdict from a process that died
 * before reaching one. Drive holds one grant, so there is one account to report.
 */
export const runDriveHealth = async (log: (line: string) => void, env: NodeJS.ProcessEnv): Promise<number> => {
  try {
    const health = await checkHealth(buildDeps(env));
    const used = health.quotaUsedBytes === null ? "?" : `${(health.quotaUsedBytes / 1e9).toFixed(1)}G`;
    log(`DRIVE: ok account=${health.account} grant=${health.grant} used=${used}`);
    return OK;
  } catch (thrown) {
    const error = asAppError(thrown);
    if (!error) {
      log(`DRIVE: FAIL unexpected: ${String(thrown)}`);
      return PERMANENT;
    }
    const { code, word } = verdictOf(needsHuman(error));
    log(`DRIVE: ${word} ${error.message} -- ${remedyFor(error)}`);
    return code;
  }
};
