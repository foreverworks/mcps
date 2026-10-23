import { type AppError, describeThrownWith, OUTCOME_UNKNOWN, QUOTA_REMEDY, reconsent } from "../../domain/errors.js";

/**
 * The remedies Docs, Sheets and Slides share, because they share the grant:
 * a dead grant, a missing account and an API the Cloud project never enabled
 * mean the same fix in all three. What differs per product (where to look
 * before retrying a write, what a 400 usually means) arrives as words.
 */
export * from "../../domain/errors.js";

/**
 * The reason Google puts on a call to an API the grant's Cloud project has not
 * enabled: SERVICE_DISABLED in the newer ErrorInfo shape, accessNotConfigured
 * in the older one.
 */
export const isServiceDisabled = (reason: string | undefined): boolean =>
  reason === "SERVICE_DISABLED" || reason === "accessNotConfigured";

/** A write refused because the document moved on since it was read: our own check, or Google's. */
export const STALE_REVISION = "stale_revision";

export const GRANT_REMEDY = `the account GOOGLE_EDITORS_DRIVE_ACCOUNT names runs on the Drive grant (see list_accounts); any other account: ${reconsent("editors")}`;

export type RemedyWords = {
  /** The API as the Cloud console names it, e.g. "Google Docs API". */
  readonly api: string;
  readonly notFound: string;
  /** What to look at before retrying a write that may already have happened. */
  readonly outcomeUnknown: string;
  /** What a 400 from this API usually means. */
  readonly badRequest: string;
};

export const editorRemedy =
  (words: RemedyWords) =>
  (error: AppError): string => {
    switch (error.kind) {
      case "config":
        return GRANT_REMEDY;
      case "auth":
        if (!error.permanent) return "transient Google-side failure; retry later";
        return `the grant was refused: for the account on the Drive grant, ${reconsent("drive")}; for another account, ${reconsent("editors")}`;
      case "input":
        return "fix the arguments; nothing was sent to Google";
      case "quota":
        return QUOTA_REMEDY;
      case "not_found":
        return words.notFound;
      case "ambiguous":
        return "more than one thing answers to that; call again naming one of the candidates";
      case "api":
        if (error.reason === OUTCOME_UNKNOWN) return words.outcomeUnknown;
        if (error.reason === STALE_REVISION) return "the file changed since it was read; read it again and redo the edit against what is there now";
        if (isServiceDisabled(error.reason)) return `enable the ${words.api} in the Cloud project of the grant's OAuth client, then call again`;
        if (error.status === 404) return words.notFound;
        if (error.status === 403) return "this account cannot open or change that file; check it is shared with the account you named";
        if (error.status === 400) return words.badRequest;
        // The kit refuses a host outside MCP_EGRESS_ALLOW before any packet leaves: waiting will not fix that.
        if (error.status === 0 && /MCP_EGRESS_ALLOW/.test(error.message)) return "this deployment does not let the server reach that host: add it to MCP_EGRESS_ALLOW";
        return error.status === 0 ? "Google was unreachable; retry later" : "retry; if it persists, read the body field";
    }
  };

/** The shared section's own remedy (list_accounts, health), where no one product is in play. */
export const remedyFor = editorRemedy({
  api: "API the message names",
  notFound: "check the file id and the account; a file is visible only to the accounts it is shared with",
  outcomeUnknown: "look at the file before retrying: the write may have happened",
  badRequest: "read the body field: Google names the argument it refused",
});

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
