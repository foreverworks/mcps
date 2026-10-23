import { SCOPE_ROOT } from "../../domain/scopes.js";

/**
 * Read the meetings the account took part in: their records, transcripts,
 * smart notes and recordings. The least scope that reads them; the others
 * (meetings.space.created, meetings.space.settings) create or change spaces.
 */
export const MEETINGS_SPACE_READONLY = `${SCOPE_ROOT}meetings.space.readonly`;
export const REQUIRED_SCOPES = [MEETINGS_SPACE_READONLY] as const;
