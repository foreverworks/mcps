import { OK, runHealthCli } from "@foreverworks/receipts/cli";

import { checkHealth } from "../app/usecases/health.js";
import { buildDeps } from "../composition.js";
import { VOCABULARY } from "../domain/errors.js";

/**
 * `--health`, with the contract every receipts server's check has
 * (packages/receipts, cli/health.ts): every line starts with `GLOVO:`. Unlike
 * bolt-food there is no expiry warning: Glovo's refresh token has no `exp`
 * claim, so there is nothing to count down.
 */
export const runHealthCheck = (log?: (line: string) => void): Promise<number> =>
  runHealthCli(
    {
      label: "GLOVO",
      check: () => checkHealth(buildDeps()),
      verdict: (h) => ({
        exit: OK,
        line:
          `ok user=${h.userId} latest=${h.latestOrder?.orderId} ${h.latestOrder?.localDate} ${h.latestOrder?.state} ` +
          `firstPage=${h.firstPageOrders} stored=${h.storedOrderDetails}`,
      }),
      vocabulary: VOCABULARY,
    },
    log,
  );
