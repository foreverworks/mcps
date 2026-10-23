import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Meet's records, transcripts and notes: read only. */
export const MEET: ToolPolicy = {
  list_meetings: { access: "read" },
  get_transcript: { access: "read" },
};
