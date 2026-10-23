import { type AppError, describeThrownWith, OUTCOME_UNKNOWN, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/** Tasks' remedies; the failures are Google's, shared (src/domain/errors.ts). */
export * from "../../domain/errors.js";

export const RECONSENT = reconsent("tasks");

export const remedyFor = (error: AppError): string => {
  if (error.kind === "config") return `fix the variable or file the message names, or ${RECONSENT}`;
  if (error.kind === "input") return "fix the arguments; nothing was sent to Google Tasks";
  if (error.kind === "quota") return QUOTA_REMEDY;
  if (error.kind === "not_found" || error.kind === "ambiguous") return "check the task id and the list id with list_tasks; a task lives in ONE list of ONE account";
  if (error.kind === "api") {
    if (error.reason === OUTCOME_UNKNOWN) return "run list_tasks before retrying: a blind retry could create the task twice";
    if (error.reason === "SERVICE_DISABLED" || error.reason === "accessNotConfigured") return "enable the Google Tasks API in the Cloud project of the grant's OAuth client, then call again";
    if (error.status === 403) return `the grant lacks the tasks scope; ${RECONSENT}`;
    if (error.status === 404) return "check the task id and the list id with list_tasks; a task lives in ONE list of ONE account";
    return "retry, or check the ids";
  }
  if (error.code === "insufficient_scope") return RECONSENT;
  return error.permanent ? `the refresh token is expired or revoked; ${RECONSENT}` : "transient Google-side failure; retry later";
};

export const describeThrown = describeThrownWith(remedyFor);
