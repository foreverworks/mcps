import { inSeries, OK, PERMANENT, verdictOf, worst } from "@foreverworks/mcp-kit";

import { buildRegistries, type Registries } from "../composition.js";
import { checkHealth as checkContacts } from "../contacts/app/usecases.js";
import { asAppError, type AppError, needsHuman } from "../domain/errors.js";
import { remedyFor as contactsRemedy } from "../contacts/domain/errors.js";
import type { Grant } from "../grants/grant.js";
import type { GrantRegistry } from "../grants/registry.js";
import { checkHealth as checkMeet } from "../meet/app/usecases.js";
import { remedyFor as meetRemedy } from "../meet/domain/errors.js";
import { checkHealth as checkTasks } from "../tasks/app/usecases.js";
import { remedyFor as tasksRemedy } from "../tasks/domain/errors.js";

type Checked = { readonly ok: boolean; readonly address?: string; readonly api: string; readonly missingScopes?: readonly string[]; readonly addressMatches: boolean | null };

/**
 * The shell-callable check of a product that holds one grant per account
 * (Tasks, Contacts, Meet): one `<PRODUCT>:` line per account, like Calendar's.
 * A product nobody has consented yet is not a failure: it says so and passes,
 * because nothing that was working has stopped.
 */
const runGrantHealth =
  <D extends { readonly grant: Grant }>(prefix: string, pick: (r: Registries) => GrantRegistry<D>, check: (deps: D) => Promise<Checked>, remedyFor: (e: AppError) => string) =>
  async (log: (line: string) => void, env: NodeJS.ProcessEnv): Promise<number> => {
    let registry: GrantRegistry<D>;
    try {
      registry = pick(buildRegistries(env));
    } catch (thrown) {
      const error = asAppError(thrown);
      log(`${prefix}: FAIL registry ${error ? error.message : String(thrown)}`);
      return PERMANENT;
    }
    if (registry.labels.length === 0) {
      log(`${prefix}: ok no account has a ${registry.product} grant yet (begin_consent, product ${registry.product})`);
      return OK;
    }
    return worst(
      await inSeries(registry.labels, async (label) => {
        try {
          const deps = registry.get(label);
          const h = await check(deps);
          if (h.ok) {
            log(`${prefix}: ok account=${label} address=${h.address ?? "?"}`);
            return OK;
          }
          const problems = [
            ...(h.missingScopes?.length ? [`missing ${h.missingScopes.join(", ")}`] : []),
            ...(h.addressMatches === false ? [`resolves to ${h.address ?? "?"}`] : []),
            ...(h.api !== "enabled" ? [`api ${h.api}`] : []),
          ];
          log(`${prefix}: FAIL account=${label} ${problems.join("; ")} -- ${registry.credentialsPath(label)}`);
          return PERMANENT;
        } catch (thrown) {
          const error = asAppError(thrown);
          if (!error) {
            log(`${prefix}: FAIL account=${label} unexpected: ${String(thrown)}`);
            return PERMANENT;
          }
          const { code, word } = verdictOf(needsHuman(error));
          log(`${prefix}: ${word} account=${label} ${error.kind === "auth" ? `${error.code}: ${error.message}` : error.message} -- ${remedyFor(error)}`);
          return code;
        }
      }),
    );
  };

export const runTasksHealth = runGrantHealth("TASKS", (r) => r.tasks, checkTasks, tasksRemedy);
export const runContactsHealth = runGrantHealth("CONTACTS", (r) => r.contacts, checkContacts, contactsRemedy);
export const runMeetHealth = runGrantHealth("MEET", (r) => r.meet, checkMeet, meetRemedy);
