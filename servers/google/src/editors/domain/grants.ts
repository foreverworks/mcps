/**
 * What a grant must carry for Docs, Sheets and Slides. Pure.
 *
 * Two shapes pass:
 *   drive                    every file the account can see, in all three APIs
 *                            and in Drive (copy a template, create in a folder)
 *   documents + spreadsheets + presentations + drive.file
 *                            every document, spreadsheet and deck through its own
 *                            API, and through Drive only the files this client
 *                            created or opened. Copying a template the client
 *                            did not create then fails on Drive's side.
 * The Drive grant is the first; a grant consented for Docs, Sheets and Slides
 * is the second, or may be seeded with the first.
 */
import { DOCUMENTS, DRIVE, DRIVE_FILE, PRESENTATIONS, SPREADSHEETS } from "../../domain/scopes.js";

export { DOCUMENTS, DRIVE, DRIVE_FILE, PRESENTATIONS, SPREADSHEETS, splitScopes } from "../../domain/scopes.js";

export const NARROW_SCOPES = [DOCUMENTS, SPREADSHEETS, PRESENTATIONS, DRIVE_FILE] as const;

/** Nothing is missing under the full drive scope; otherwise, whichever of the narrow four are absent. */
export const missingScopes = (granted: readonly string[]): readonly string[] =>
  granted.includes(DRIVE) ? [] : NARROW_SCOPES.filter((s) => !granted.includes(s));
