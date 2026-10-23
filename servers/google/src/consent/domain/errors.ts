import { type AppError, describeThrownWith, QUOTA_REMEDY } from "../../domain/errors.js";

/**
 * Consent's half of the failure vocabulary: the remedies. Every one of them
 * ends in beginning again, because an authorization code is single-use and a
 * waiting consent is spent by its first completion.
 */
export * from "../../domain/errors.js";

const AGAIN = "begin_consent again, have the account's user approve it in a browser, and pass complete_consent the URL the browser lands on";

export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "the account needs an address in GMAIL_ADDRESSES and an OAuth client (GOOGLE_OAUTH_CLIENT_FILE, or a credentials file the account already has); the message names which is missing";
    case "input":
      return `${AGAIN}, within 15 minutes`;
    case "auth":
      if (error.code === "insufficient_scope") return `${AGAIN}; every box on Google's screen must be ticked`;
      if (error.code === "wrong_account") return `${AGAIN}; pick the account the message names in Google's chooser`;
      if (error.code === "invalid_grant") return `the code was already used or has expired; ${AGAIN}`;
      return error.permanent ? AGAIN : `Google's token endpoint was unreachable; the code may still be good for a minute, so complete_consent once more, else ${AGAIN}`;
    case "quota":
      return QUOTA_REMEDY;
    case "not_found":
    case "ambiguous":
      return AGAIN;
    case "api":
      return `Google did not answer who approved; ${AGAIN}`;
  }
};

export const describeThrown = describeThrownWith(remedyFor);
