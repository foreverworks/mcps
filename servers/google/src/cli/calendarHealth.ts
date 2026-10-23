import { inSeries, OK, PERMANENT, verdictOf, worst } from "@foreverworks/mcp-kit";

import type { Deps } from "../calendar/app/ports.js";
import { checkHealth } from "../calendar/app/usecases/health.js";
import { buildRegistry } from "../calendar/composition.js";
import { asAppError, remedyFor } from "../calendar/domain/errors.js";
import { needsHuman } from "../domain/errors.js";

/**
 * Calendar's part of the shell-callable health check. Every line starts with `CALENDAR:`, for the reason the Gmail
 * half's lines start with `GMAIL:` (cli/gmailHealth.ts), and there is one line
 * per account.
 */
const verdictFor = async (deps: Deps, log: (line: string) => void): Promise<number> => {
  try {
    const h = await checkHealth(deps);
    if (!h.ok) {
      log(`CALENDAR: FAIL account=${deps.account} ${(h.problems ?? []).join("; ")} -- ${deps.grant.credentials}`);
      return PERMANENT;
    }
    log(`CALENDAR: ok account=${deps.account} calendar=${h.calendarOf} canWrite=${h.canWrite}`);
    return OK;
  } catch (thrown) {
    const error = asAppError(thrown);
    if (!error) {
      log(`CALENDAR: FAIL account=${deps.account} unexpected: ${String(thrown)}`);
      return PERMANENT;
    }
    const { code, word } = verdictOf(needsHuman(error));
    const label = error.kind === "auth" ? `${error.code}: ${error.message}` : error.message;
    log(`CALENDAR: ${word} account=${deps.account} ${label} -- ${remedyFor(error)}`);
    return code;
  }
};

/** Every account, or the fault that stopped the registry from building or left it empty. */
const accountsOf = (env: NodeJS.ProcessEnv): readonly Deps[] | { readonly fault: string } => {
  try {
    const registry = buildRegistry(env);
    return registry.labels.length === 0
      ? { fault: `no account has a grant under ${registry.root}` }
      : registry.labels.map((label) => registry.get(label));
  } catch (thrown) {
    const error = asAppError(thrown);
    return { fault: `registry ${error ? error.message : String(thrown)}` };
  }
};

export const runCalendarHealth = async (log: (line: string) => void, env: NodeJS.ProcessEnv): Promise<number> => {
  const accounts = accountsOf(env);
  if ("fault" in accounts) {
    log(`CALENDAR: FAIL ${accounts.fault}`);
    return PERMANENT;
  }
  return worst(await inSeries(accounts, (deps) => verdictFor(deps, log)));
};
