import { describeThrownWith, editorRemedy } from "../../editors/domain/errors.js";

/**
 * Collaboration's remedies. The failures are Google's (src/domain/errors.ts)
 * and the grant's remedies the editors' (src/editors); what is its own is below.
 */
export * from "../../editors/domain/errors.js";

export const remedyFor = editorRemedy({
  api: "Google Drive API",
  notFound: "check the file id (and the comment, reply, permission or revision id) and the account: a file is visible only to the accounts it is shared with",
  outcomeUnknown: "list it again before retrying: the comment, reply or permission may have been made, and repeating it makes a second",
  badRequest: "the body field names what Drive refused",
});

export const describeThrown = describeThrownWith(remedyFor);
