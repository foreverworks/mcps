import { makeFailureVerdict, OK } from "@foreverworks/mcp-kit";

import { checkHealth } from "../app/usecases/nomenclature.js";
import { buildDeps } from "../composition.js";
import { type AppError, asAppError, DRIFT, remedyFor } from "../domain/errors.js";

/**
 * A refused secret, a bad app.json and an answer that changed shape all need a
 * human. Throttling does not, and waking somebody for it is how a check stops
 * being believed.
 */
const needsHuman = (error: AppError): boolean =>
  error.kind === "config" ||
  error.kind === "auth" ||
  error.kind === "input" ||
  (error.kind === "api" && (error.status === 401 || error.status === 403 || error.reason === DRIFT));

const failureVerdict = makeFailureVerdict({ prefix: "OBLIO", asAppError, needsHuman, remedyFor });

/**
 * The shell-callable health check, for a timer to run daily: ONE line starting
 * `OBLIO:` and an exit code, the kit's contract (packages/mcp-kit, verdict.ts).
 * OK means the credentials work.
 */
export const runHealthCheck = async (log: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  try {
    const h = await checkHealth(buildDeps(env));
    log(`OBLIO: ok account=${h.account} cif=${h.companyCif}`);
    return OK;
  } catch (thrown) {
    const { code, line } = failureVerdict(thrown);
    log(line);
    return code;
  }
};
