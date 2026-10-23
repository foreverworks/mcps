import { type AppError, describeThrownWith, OUTCOME_UNKNOWN, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/**
 * Gmail's half of the failure vocabulary: the remedies. The failures
 * themselves are Google's and live in the shared module, re-exported here so
 * nothing under gmail/ has to know which half it is importing.
 */
export * from "../../domain/errors.js";

/** The one re-consent instruction, so every place that needs it says the same thing. */
export const RECONSENT = reconsent("gmail");

/** A read-only grant is made outside this server (by whatever shares it), so it is renewed there too. */
const READONLY = "renew a read-only grant (GMAIL_ACCOUNTS) the way it was made: this server consents only its own modify grant";

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  if (error.kind === "config") return `fix the variable or file the message names; for an account's own grant, ${RECONSENT}`;
  if (error.kind === "input") return "fix the arguments; nothing was sent to Gmail";
  if (error.kind === "quota") return QUOTA_REMEDY;
  if (error.kind === "not_found" || error.kind === "ambiguous") return "check the id; nothing was changed in Gmail";
  if (error.kind === "api") {
    if (error.reason === OUTCOME_UNKNOWN) return "look in Sent or Drafts before retrying: a blind retry could send or file it twice";
    if (error.status === 403) return `the token lacks the scope this call needs; for a write, ${RECONSENT}`;
    // list_history's 404 is not a bad id: Gmail expires old history ids, and
    // the anchor has to be re-baselined with a full search.
    if (error.status === 404) return "check the id; on list_history it means the historyId expired, so re-baseline with a search";
    return "retry, or check the id";
  }
  if (error.code === "readonly_grant" || error.code === "insufficient_scope") return RECONSENT;
  if (error.code === "deleted_client")
    return "credentials.json points at an OAuth client that no longer exists; check its client_id in the Google Cloud console";
  return error.permanent
    ? `the refresh token is expired or revoked; for the modify grant ${RECONSENT}; ${READONLY}`
    : "transient Google-side failure; retry later";
};

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
