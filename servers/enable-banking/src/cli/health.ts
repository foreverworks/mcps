import { makeFailureVerdict, OK } from "@foreverworks/mcp-kit";

import { checkHealth } from "../app/usecases/banks.js";
import { buildDeps } from "../composition.js";
import { type AppError, asAppError, remedyFor } from "../domain/errors.js";

/**
 * An unusable key and a bad app.json both need a human; a 5xx does not, and
 * waking somebody for it is how a check stops being believed.
 */
const needsHuman = (error: AppError): boolean =>
  error.kind === "config" ||
  error.kind === "auth" ||
  error.kind === "input" ||
  (error.kind === "api" && (error.status === 401 || error.status === 403));

const failureVerdict = makeFailureVerdict({ prefix: "ENABLEBANKING", asAppError, needsHuman, remedyFor });

/**
 * The shell-callable health check, for a timer to run daily: ONE line starting
 * `ENABLEBANKING:` and an exit code, the kit's contract (packages/mcp-kit,
 * verdict.ts). OK means the key pair works.
 */
export const runHealthCheck = async (log: (line: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  try {
    const h = await checkHealth(buildDeps(env));
    log(`ENABLEBANKING: ok app=${h.applicationName} env=${h.environment} sessions=${h.storedSessions}`);
    return OK;
  } catch (thrown) {
    const { code, line } = failureVerdict(thrown);
    log(line);
    return code;
  }
};
