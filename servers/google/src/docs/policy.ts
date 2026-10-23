import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Docs' tools, classified (packages/mcp-kit policy.ts); merged into the server's in src/mcp/policy.ts. */
export const DOCS: ToolPolicy = {
  read_document: { access: "read" },
  edit_document_section: { access: "write" },
  create_document: { access: "write" },
  append_to_document: { access: "write" },
  get_document: { access: "read" },
  find_in_document: { access: "read" },
  batch_update_document: { access: "write" },
};
