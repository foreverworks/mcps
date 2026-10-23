import { inSeries, OK, PERMANENT, verdictOf, worst } from "@foreverworks/mcp-kit";

import type { Deps, GrantHandle } from "../gmail/app/ports.js";
import { verifyGrant } from "../gmail/app/usecases/verifyGrant.js";
import { buildRegistry } from "../gmail/composition.js";
import { asAppError, remedyFor } from "../gmail/domain/errors.js";
import { needsHuman } from "../domain/errors.js";
import { NO_MAILBOX } from "../gmail/infra/accounts.js";

/**
 * Gmail's part of the shell-callable health check (`--health gmail`), for a
 * scheduled check or a human at a terminal.
 *
 * THE OUTPUT IS THE CONTRACT, not just the exit code. Every line starts with
 * `GMAIL:`, so a caller can tell "this ran and reached a verdict" from "this
 * crashed before it could say anything" — which matters because a stale
 * checkout, a missing build or an uncaught error would otherwise be reported as
 * a dead Google grant and send an operator to fix something that was never
 * broken.
 *
 * The lines are per account AND per grant (an account may hold its own
 * gmail.modify grant and a read-only one another program shares): a live
 * mailbox must not mask a dead one, nor one grant hide behind the other.
 */
const verdictFor = async (deps: Deps, grant: GrantHandle, log: (line: string) => void): Promise<number> => {
  const tag = `account=${deps.account} grant=${grant.role}${grant === deps.grant ? "(active)" : ""}`;
  try {
    const v = await verifyGrant(grant, deps.address);
    if (!v.ok) {
      log(`GMAIL: FAIL ${tag} ${v.problems.join("; ")} -- ${grant.credentials}`);
      return PERMANENT;
    }
    log(`GMAIL: ok ${tag} mailbox=${v.mailbox} scope=${v.grantedScope} historyId=${v.historyId}`);
    return OK;
  } catch (thrown) {
    const error = asAppError(thrown);
    if (!error) {
      log(`GMAIL: FAIL ${tag} unexpected: ${String(thrown)}`);
      return PERMANENT;
    }
    const { code, word } = verdictOf(needsHuman(error));
    const label = error.kind === "auth" ? `${error.code}: ${error.message}` : error.message;
    log(`GMAIL: ${word} ${tag} ${label} -- ${remedyFor(error)}`);
    return code;
  }
};

/** Every account, or the fault that stopped the registry from building. */
const accountsOf = (env: NodeJS.ProcessEnv): readonly Deps[] | { readonly fault: string } => {
  try {
    const registry = buildRegistry(env);
    return registry.labels.length === 0 ? { fault: NO_MAILBOX } : registry.labels.map((label) => registry.get(label));
  } catch (thrown) {
    // A registry that will not build is a config fault, and naming it here is
    // the difference between "re-run the OAuth flow" and "fix the env var".
    const error = asAppError(thrown);
    return { fault: error ? error.message : String(thrown) };
  }
};

export const runGmailHealth = async (log: (line: string) => void, env: NodeJS.ProcessEnv): Promise<number> => {
  const accounts = accountsOf(env);
  if ("fault" in accounts) {
    log(`GMAIL: FAIL registry ${accounts.fault}`);
    return PERMANENT;
  }
  const grants = accounts.flatMap((deps) => deps.grants.map((grant) => ({ deps, grant })));
  return worst(await inSeries(grants, ({ deps, grant }) => verdictFor(deps, grant, log)));
};
