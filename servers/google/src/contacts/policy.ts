import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Contacts and the directory: one read. */
export const CONTACTS: ToolPolicy = {
  find_people: { access: "read" },
};
