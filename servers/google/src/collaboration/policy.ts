import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Collaboration's tools, classified (packages/mcp-kit policy.ts); merged into
 * the server's in src/mcp/policy.ts. Sharing is a write, like a sent mail: the
 * descriptions say it needs the user's explicit go. Nothing here is money.
 */
export const COLLABORATION: ToolPolicy = {
  list_comments: { access: "read" },
  add_comment: { access: "write" },
  reply_to_comment: { access: "write" },
  edit_comment: { access: "write" },
  delete_comment: { access: "write" },
  list_permissions: { access: "read" },
  share_file: { access: "write" },
  update_permission: { access: "write" },
  remove_permission: { access: "write" },
  list_revisions: { access: "read" },
  // Writes only into the downloads folder; on Drive it reads.
  download_revision: { access: "read" },
  update_revision: { access: "write" },
};
