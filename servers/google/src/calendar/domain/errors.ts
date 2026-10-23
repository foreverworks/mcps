import { type AppError, describeThrownWith, OUTCOME_UNKNOWN, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/**
 * Calendar's half of the failure vocabulary: the remedies. The failures
 * themselves are Google's and live in the shared module, re-exported here so
 * nothing under calendar/ has to know which half it is importing.
 */
export * from "../../domain/errors.js";

/** The one re-consent instruction, so every place that needs it says the same thing. */
export const RECONSENT = reconsent("calendar");

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  if (error.kind === "config") return `fix the variable or file the message names, or ${RECONSENT}`;
  if (error.kind === "input") return "fix the arguments; nothing was sent to Google Calendar";
  if (error.kind === "quota") return QUOTA_REMEDY;
  if (error.kind === "not_found" || error.kind === "ambiguous") return "check the event id and the calendar id; an event lives on ONE calendar of ONE account";
  if (error.kind === "api") {
    if (error.reason === OUTCOME_UNKNOWN) return "run agenda for that day before retrying: a blind retry could create the event twice";
    if (error.status === 403) return `the grant lacks the scope this call needs, or the calendar is read-only for this account; ${RECONSENT}`;
    if (error.status === 404) return "check the event id and the calendar id; an event lives on ONE calendar of ONE account";
    if (error.status === 410) return "the event was already deleted";
    return "retry, or check the ids";
  }
  if (error.code === "insufficient_scope") return RECONSENT;
  if (error.code === "deleted_client")
    return "credentials.json points at an OAuth client that no longer exists; check its client_id in the Google Cloud console";
  return error.permanent ? `the refresh token is expired or revoked; ${RECONSENT}` : "transient Google-side failure; retry later";
};

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
