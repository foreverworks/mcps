import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Every tool, classified (packages/mcp-kit, policy.ts). Reading a central bank's published rates changes nothing anywhere. */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  rate: { access: "read" },
  rates: { access: "read" },
  convert: { access: "read" },
};
