import { describeThrownWith, editorRemedy } from "../../editors/domain/errors.js";

/**
 * Sheets' half of the failure vocabulary: the remedies. The failures are
 * Google's (src/domain/errors.ts) and the grant's remedies are shared with
 * Docs and Slides (src/editors); what is Sheets' own is below.
 */
export * from "../../editors/domain/errors.js";

export const remedyFor = editorRemedy({
  api: "Google Sheets API",
  notFound: "check the spreadsheet id, the sheet name (list_sheets) and the account the file is shared with",
  outcomeUnknown: "read_rows before retrying: the rows may have been written, and appending twice duplicates them",
  badRequest: "check the range and the sheet name against list_sheets; the body field names what Sheets refused",
});

/** One failure as a sentence with its remedy, for the paths that report it and carry on. */
export const describeThrown = describeThrownWith(remedyFor);
