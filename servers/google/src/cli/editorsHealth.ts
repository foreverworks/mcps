import { inSeries, OK, PERMANENT, verdictOf, worst } from "@foreverworks/mcp-kit";

import { buildDriveAndEditors } from "../composition.js";
import type { Editors } from "../editors/composition.js";
import { checkHealth } from "../editors/app/health.js";
import { asAppError, remedyFor } from "../editors/domain/errors.js";
import { needsHuman } from "../domain/errors.js";

/**
 * The shell-callable health check for Docs, Sheets and Slides: one `EDITORS:`
 * line per account with a grant. An account without one (until it is
 * consented) is not a failure; it is reported by list_accounts.
 */
const lineFor = async (editors: Editors, label: string, log: (line: string) => void): Promise<number> => {
  try {
    const h = await checkHealth(editors.account(label).health);
    const apis = Object.entries(h.apis).map(([api, state]) => `${api}=${state === "enabled" || state === "disabled" ? state : "error"}`).join(" ");
    if (!h.ok) {
      const why = [
        ...(h.missingScopes.length ? [`missing scopes: ${h.missingScopes.join(", ")}`] : []),
        ...(h.addressMatches === false ? [`resolves to ${h.address}`] : []),
        ...Object.entries(h.apis).flatMap(([api, state]) => (state === "enabled" ? [] : [`${api}: ${state}`])),
      ];
      log(`EDITORS: FAIL account=${label} ${apis} -- ${why.join("; ")}`);
      return PERMANENT;
    }
    log(`EDITORS: ok account=${label} address=${h.address} ${apis}`);
    return OK;
  } catch (thrown) {
    const error = asAppError(thrown);
    if (!error) {
      log(`EDITORS: FAIL account=${label} unexpected: ${String(thrown)}`);
      return PERMANENT;
    }
    const { code, word } = verdictOf(needsHuman(error));
    log(`EDITORS: ${word} account=${label} ${error.message} -- ${remedyFor(error)}`);
    return code;
  }
};

export const runEditorsHealth = async (log: (line: string) => void, env: NodeJS.ProcessEnv): Promise<number> => {
  const { editors } = buildDriveAndEditors(env);
  const labels = editors.specs().map((s) => s.label);
  if (labels.length === 0) {
    log("EDITORS: FAIL no account has a Docs/Sheets/Slides grant");
    return PERMANENT;
  }
  return worst(await inSeries(labels, (label) => lineFor(editors, label, log)));
};
