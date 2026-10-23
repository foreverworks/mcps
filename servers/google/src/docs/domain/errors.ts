import { describeThrownWith, editorRemedy } from "../../editors/domain/errors.js";

/**
 * Docs' half of the failure vocabulary: the remedies. The failures are
 * Google's (src/domain/errors.ts) and the grant's remedies are shared with
 * Sheets and Slides (src/editors); what is Docs' own is below.
 */
export * from "../../editors/domain/errors.js";

export const remedyFor = editorRemedy({
  api: "Google Docs API",
  notFound: "check the document id and the account: a document is visible only to the accounts it is shared with",
  outcomeUnknown: "read_document before retrying: the edit may have been applied, and applying it twice duplicates the text",
  badRequest:
    "if the document changed since it was read, read it again and redo the edit; otherwise the body field names the request Docs refused",
});

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
