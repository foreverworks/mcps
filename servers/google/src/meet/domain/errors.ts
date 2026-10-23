import { type AppError, describeThrownWith, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/** Meet's remedies; the failures are Google's, shared (src/domain/errors.ts). */
export * from "../../domain/errors.js";

export const RECONSENT = reconsent("meet");

export const remedyFor = (error: AppError): string => {
  if (error.kind === "config") return `fix the variable or file the message names, or ${RECONSENT}`;
  if (error.kind === "input") return "fix the arguments; nothing was sent to Google Meet";
  if (error.kind === "quota") return QUOTA_REMEDY;
  if (error.kind === "not_found" || error.kind === "ambiguous") return "check the ids with list_meetings";
  if (error.kind === "api") {
    if (error.reason === "SERVICE_DISABLED" || error.reason === "accessNotConfigured") return "enable the Google Meet REST API in the Cloud project of the grant's OAuth client, then call again";
    if (error.status === 403) return `this account cannot read that meeting, or the grant lacks meetings.space.readonly; ${RECONSENT}`;
    if (error.status === 404) return "Meet keeps a meeting's records for 30 days after it ends; check the ids with list_meetings";
    return "retry, or check the ids";
  }
  if (error.code === "insufficient_scope") return RECONSENT;
  return error.permanent ? `the refresh token is expired or revoked; ${RECONSENT}` : "transient Google-side failure; retry later";
};

export const describeThrown = describeThrownWith(remedyFor);
