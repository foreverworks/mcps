import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Every tool, classified (packages/mcp-kit, policy.ts). Searching a public register changes nothing anywhere. */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  search_marks: { access: "read" },
  get_mark: { access: "read" },
  mark_history: { access: "read" },
  mark_documents: { access: "read" },
  // Writes only into the server's own outbox: nothing outside the server changes.
  download_mark_documents: { access: "read" },
};
