import { authError, fail } from "../../domain/errors.js";
import { canEditFilters, canWrite } from "../../domain/grants.js";
import type { Deps } from "../ports.js";

/**
 * Every write use case calls this FIRST, before it reads or builds anything.
 *
 * Two refusals, both loud and both before any request reaches Gmail:
 * - the account is running on its read-only grant, because it has no modify
 *   grant of its own (never consented, or its file is missing);
 * - it has one, but the issuer says the token does not carry gmail.modify (the
 *   box was left unticked on Google's granular consent screen).
 *
 * The second check costs nothing on the common path: the granted scope is
 * recorded when the access token is minted.
 */
export const requireWrite = async (deps: Deps): Promise<void> => {
  if (deps.grant.role !== "modify") {
    const where = deps.modifyPath
      ? `its own gmail.modify grant is configured at ${deps.modifyPath} but that file does not exist`
      : "no gmail.modify grant is configured for it";
    return fail(
      authError(
        "readonly_grant",
        `account "${deps.account}" is on its READ-ONLY grant (${deps.grant.credentials}): ${where}. Nothing was sent.`,
      ),
    );
  }
  const granted = await deps.grant.scopes();
  if (!canWrite(granted)) {
    return fail(
      authError(
        "insufficient_scope",
        `account "${deps.account}"'s own grant (${deps.grant.credentials}) carries "${granted.join(" ")}", not gmail.modify. Nothing was sent.`,
      ),
    );
  }
};

/**
 * Creating or deleting a filter: everything requireWrite checks, and then
 * gmail.settings.basic, which gmail.modify does not include. A modify grant
 * consented before the filter tools existed lacks it until it is consented
 * again; every other write keeps working meanwhile.
 */
export const requireFilters = async (deps: Deps): Promise<void> => {
  await requireWrite(deps);
  const granted = await deps.grant.scopes();
  if (!canEditFilters(granted)) {
    return fail(
      authError(
        "insufficient_scope",
        `account "${deps.account}"'s grant (${deps.grant.credentials}) carries "${granted.join(" ")}" but not gmail.settings.basic, which Gmail requires to create or delete a filter. Nothing was sent.`,
      ),
    );
  }
};
