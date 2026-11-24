import type { ToolSpec } from "./schema.js";

/**
 * Every Granola tool this server has read and decided about. A tool that only
 * reads a person's meetings is `forward`: offered here under its own name. One
 * that writes, or that acts on the account itself (folders, titles, summaries,
 * private notes, a note made from a transcript, feedback, a sign-out, a switch of workspace), is
 * `withhold`: it is never offered, so a client that can read your meetings
 * cannot change them or sign the account out. A tool Granola adds is in
 * neither list, so it is not offered until someone reads it and decides
 * (mcp/policy.ts builds the policy from the forwarded ones).
 */
export const UPSTREAM_TOOLS = {
  search_meetings: "forward",
  list_meetings: "forward",
  get_meetings: "forward",
  get_meeting_transcript: "forward",
  search_transcripts: "forward",
  list_meeting_folders: "forward",
  get_meeting_attachment: "forward",
  get_account_info: "forward",
  list_templates: "forward",
  get_agent_brief: "forward",
  query_granola_meetings: "forward",
  create_folder: "withhold",
  update_folder: "withhold",
  add_note_to_folder: "withhold",
  remove_note_from_folder: "withhold",
  update_meeting_title: "withhold",
  update_private_notes: "withhold",
  update_summary: "withhold",
  generate_summary: "withhold",
  create_meeting_note_from_transcript: "withhold",
  give_feedback: "withhold",
  sign_out: "withhold",
  switch_workspace: "withhold",
} as const satisfies Readonly<Record<string, "forward" | "withhold">>;

const namesWhere = (kind: "forward" | "withhold"): readonly string[] => Object.entries(UPSTREAM_TOOLS).filter(([, k]) => k === kind).map(([name]) => name);

/** The tools offered here: Granola's read-only ones. */
export const KNOWN_TOOLS = namesWhere("forward");

/** The tools Granola lists that this server deliberately never offers. */
export const WITHHELD_TOOLS = namesWhere("withhold");

/** What each forwarded tool is for, shown until Granola's own description has been listed. */
export const FALLBACK_LINES: Readonly<Record<string, string>> = {
  search_meetings: "Find meetings by topic, keyword, person, company, date or folder.",
  list_meetings: "List meetings by date, without a search query.",
  get_meetings: "Read meetings by id: notes, AI summary, attendees and note links.",
  get_meeting_transcript: "Read the word-for-word transcript of a meeting (needs a paid Granola plan).",
  search_transcripts: "Search what was said across meeting transcripts (needs a paid Granola plan).",
  list_meeting_folders: "List the account's meeting folders.",
  get_meeting_attachment: "View a screenshot or photo attached to a meeting.",
  get_account_info: "Say which Granola account and plan this grant belongs to.",
  list_templates: "List the note templates available to the account.",
  get_agent_brief: "Read the account's work context: role, projects and internal terms.",
  query_granola_meetings: "Ask a question across meetings and let Granola answer it (the slowest tool).",
};

export type TourOfTools = {
  /** Listed upstream and forwarded here: callable. */
  readonly exposed: readonly string[];
  /** Listed upstream and read, but a write or account tool: never offered here. */
  readonly withheld: readonly string[];
  /** Listed upstream, not yet read by anyone here: hidden, until the code says what they are. */
  readonly hidden: readonly string[];
  /** Forwarded here, not listed upstream (renamed, retired or not offered to this account). */
  readonly missing: readonly string[];
};

/** How the upstream's list and this server's classification compare. */
export const tourOf = (listed: readonly Pick<ToolSpec, "name">[], known: readonly string[] = KNOWN_TOOLS, withheld: readonly string[] = WITHHELD_TOOLS): TourOfTools => {
  const names = listed.map((t) => t.name);
  return {
    exposed: names.filter((n) => known.includes(n)).sort(),
    withheld: names.filter((n) => withheld.includes(n)).sort(),
    hidden: names.filter((n) => !known.includes(n) && !withheld.includes(n)).sort(),
    missing: known.filter((n) => !names.includes(n)).sort(),
  };
};
