import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** The tools Docs, Sheets and Slides share, classified (packages/mcp-kit policy.ts); merged into the server's in src/mcp/policy.ts. */
export const EDITORS: ToolPolicy = {
  editors_api_reference: { access: "read" },
};
