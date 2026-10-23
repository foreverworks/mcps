import { inSeries, makeFailureVerdict, OK, TRANSIENT, type Verdict, worst } from "@foreverworks/mcp-kit";

import { NOTHING_SHARED, probeAccount } from "../app/usecases/accounts.js";
import { buildDeps } from "../composition.js";
import { chooseAccounts } from "../domain/accounts.js";
import { type AppError, asAppError, DRIFT, remedyFor } from "../domain/errors.js";

/**
 * A missing or refused token, a missing capability, arguments this server
 * built wrong and an answer that changed shape all need a human. Throttling
 * and an unwell Notion do not, and waking somebody for them is how a check
 * stops being believed.
 */
const needsHuman = (error: AppError): boolean =>
  error.kind === "config" ||
  error.kind === "auth" ||
  error.kind === "forbidden" ||
  error.kind === "input" ||
  error.kind === "not_shared" ||
  (error.kind === "api" && error.reason === DRIFT);

const failureVerdict = makeFailureVerdict({ prefix: "NOTION", asAppError, needsHuman, remedyFor });

/**
 * The shell-callable health check, for a timer to run daily: ONE line per
 * workspace starting `NOTION:`, and the worst of their exit codes, the kit's
 * contract (packages/mcp-kit, verdict.ts). A workspace whose integration sees
 * nothing is a WARN: its token works, and it is useless until pages are shared.
 */
export const runHealthCheck = async (log: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  const deps = buildDeps(env);
  let labels: readonly string[];
  try {
    labels = chooseAccounts(undefined, await deps.accounts.labels());
  } catch (thrown) {
    const { code, line } = failureVerdict(thrown);
    log(line);
    return code;
  }
  const verdicts = await inSeries(labels, async (label): Promise<Verdict> => {
    try {
      const probe = await probeAccount(deps, label);
      const named = `account=${label} workspace=${JSON.stringify(probe.workspace ?? "?")}`;
      return probe.seesContent
        ? { code: OK, line: `NOTION: ok ${named}` }
        : { code: TRANSIENT, line: `NOTION: WARN ${named} -- ${NOTHING_SHARED}` };
    } catch (thrown) {
      return failureVerdict(thrown, `account=${label}`);
    }
  });
  for (const { line } of verdicts) log(line);
  return worst(verdicts.map((v) => v.code));
};
