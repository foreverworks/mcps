import { OK, PERMANENT, runHealthCli } from "@foreverworks/receipts/cli";

import { checkHealth } from "../app/usecases/health.js";
import { buildDeps } from "../composition.js";
import { VOCABULARY } from "../domain/errors.js";

/**
 * `--health`, with the contract every receipts server's check has
 * (packages/receipts, cli/health.ts): every line starts with `BOLT:`. Bolt's
 * refresh token states its expiry, so one inside two weeks is a FAIL too: a
 * human has to re-extract it before the server goes dark.
 */
export const runHealthCheck = (log?: (line: string) => void): Promise<number> =>
  runHealthCli(
    {
      label: "BOLT",
      check: () => checkHealth(buildDeps()),
      verdict: (h) =>
        h.refreshTokenExpiringSoon
          ? { exit: PERMANENT, line: `FAIL refresh token expires in ${h.refreshTokenDaysLeft} days -- re-extract it before it does` }
          : {
              exit: OK,
              line: `ok user=${h.userId} orders=${h.orders} latest=${h.latestOrder?.localDate} tokenDaysLeft=${h.refreshTokenDaysLeft}`,
            },
      vocabulary: VOCABULARY,
    },
    log,
  );
