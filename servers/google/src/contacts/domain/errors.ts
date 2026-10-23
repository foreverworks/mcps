import { type AppError, describeThrownWith, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/** Contacts' remedies; the failures are Google's, shared (src/domain/errors.ts). */
export * from "../../domain/errors.js";

export const RECONSENT = reconsent("contacts");

export const remedyFor = (error: AppError): string => {
  if (error.kind === "config") return `fix the variable or file the message names, or ${RECONSENT}`;
  if (error.kind === "input") return "fix the arguments; nothing was sent to Google";
  if (error.kind === "quota") return QUOTA_REMEDY;
  if (error.kind === "api") {
    if (error.reason === "SERVICE_DISABLED" || error.reason === "accessNotConfigured") return "enable the People API in the Cloud project of the grant's OAuth client, then call again";
    if (error.status === 403) return `the grant lacks the scope this source needs; ${RECONSENT}`;
    // The directory exists only for a Workspace account: a personal one is refused this way.
    if (error.status === 400) return "this source is not available to this account (a directory needs a Workspace account)";
    return "retry later";
  }
  if (error.kind === "auth" && error.code === "insufficient_scope") return RECONSENT;
  if (error.kind === "auth") return error.permanent ? `the refresh token is expired or revoked; ${RECONSENT}` : "transient Google-side failure; retry later";
  return "check the arguments";
};

export const describeThrown = describeThrownWith(remedyFor);
