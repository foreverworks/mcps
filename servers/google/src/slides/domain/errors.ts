import { describeThrownWith, editorRemedy } from "../../editors/domain/errors.js";

/**
 * Slides' half of the failure vocabulary: the remedies. The failures are
 * Google's (src/domain/errors.ts) and the grant's remedies are shared with
 * Docs and Sheets (src/editors); what is Slides' own is below.
 */
export * from "../../editors/domain/errors.js";

export const remedyFor = editorRemedy({
  api: "Google Slides API",
  notFound: "check the presentation id and the account: a deck is visible only to the accounts it is shared with",
  outcomeUnknown: "read_deck before retrying: the slides may have been made, and making them twice duplicates them",
  badRequest: "check the layout names against list_layouts; the body field names the request Slides refused",
});

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
