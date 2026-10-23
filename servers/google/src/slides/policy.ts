import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Slides' tools, classified (packages/mcp-kit policy.ts); merged into the server's in src/mcp/policy.ts. */
export const SLIDES: ToolPolicy = {
  list_layouts: { access: "read" },
  read_deck: { access: "read" },
  get_thumbnails: { access: "read" },
  create_deck_from_outline: { access: "write" },
  fill_placeholders: { access: "write" },
  get_presentation: { access: "read" },
  batch_update_presentation: { access: "write" },
  create_presentation: { access: "write" },
};
