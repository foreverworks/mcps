import { canReadAttendeeFreeBusy, canWrite, missingScopes } from "../../domain/grants.js";
import type { Deps } from "../ports.js";
import { required } from "../../domain/errors.js";

/**
 * Alive, as whom, and with which scopes.
 *
 * "As whom" is the half that matters: the consent screen offers both Google
 * accounts, and a grant approved as the wrong one works perfectly while
 * showing the wrong calendar. The primary calendar's id is the account's
 * address, so that is what is compared.
 */
export const checkHealth = async (deps: Deps) => {
  const [primary, granted] = await Promise.all([deps.calendar.primary(), deps.grant.scopes()]);
  const calendarOf = required(primary.id, "primary calendar id");
  const missing = missingScopes(granted);
  const problems = [
    ...(missing.length ? [`the grant lacks ${missing.join(", ")}`] : []),
    ...(deps.address && calendarOf.toLowerCase() !== deps.address.toLowerCase()
      ? [`the grant resolves to ${calendarOf}, not ${deps.address}`]
      : []),
  ];
  return {
    ok: problems.length === 0,
    calendarOf,
    timeZone: primary.timeZone ?? deps.timeZone,
    grantedScopes: granted,
    canWrite: canWrite(granted),
    // Optional: without it free_busy and find_time still read the user's own calendars, and refuse only `attendees`.
    canReadAttendeeFreeBusy: canReadAttendeeFreeBusy(granted),
    credentialsPath: deps.grant.credentials,
    ...(problems.length ? { problems } : {}),
  };
};
