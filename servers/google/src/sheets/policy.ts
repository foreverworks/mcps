import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Sheets' tools, classified (packages/mcp-kit policy.ts); merged into the server's in src/mcp/policy.ts. */
export const SHEETS: ToolPolicy = {
  list_sheets: { access: "read" },
  link_sheet_cells: { access: "write" },
  read_sheet_cells: { access: "read" },
  read_rows: { access: "read" },
  append_rows: { access: "write" },
  upsert_rows: { access: "write" },
  write_range: { access: "write" },
  format_range: { access: "write" },
  add_chart: { access: "write" },
  create_spreadsheet: { access: "write" },
  get_spreadsheet: { access: "read" },
  get_values: { access: "read" },
  update_values: { access: "write" },
  clear_values: { access: "write" },
  append_values: { access: "write" },
  batch_update_spreadsheet: { access: "write" },
  copy_sheet_to: { access: "write" },
  search_developer_metadata: { access: "read" },
};
