import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). Nothing here moves
 * money or makes a legal document, so nothing is `money`. Trashing a page is a
 * `write`: Notion keeps it 30 days and restore_page undoes it.
 */
export const POLICY: ToolPolicy = {
  list_accounts: { access: "read" },
  health: { access: "read" },
  list_users: { access: "read" },
  search: { access: "read" },
  read_page: { access: "read" },
  read_blocks: { access: "read" },
  list_database_templates: { access: "read" },
  describe_database: { access: "read" },
  query_database: { access: "read" },
  count_rows: { access: "read" },
  list_views: { access: "read" },
  query_view: { access: "read" },
  download_files: { access: "read" },
  get_comments: { access: "read" },
  create_page: { access: "write" },
  update_page: { access: "write" },
  move_page: { access: "write" },
  trash_page: { access: "write" },
  restore_page: { access: "write" },
  append_content: { access: "write" },
  edit_content: { access: "write" },
  replace_content: { access: "write" },
  add_comment: { access: "write" },
  upload_file: { access: "write" },
  add_column: { access: "write" },
  add_options: { access: "write" },
  create_database: { access: "write" },
};
