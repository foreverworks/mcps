import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). An evaluation changes
 * nothing anywhere: it is billed by input tokens (fractions of a cent per
 * thousand calls, console.typesafe.ai/usage), which is metering, not a
 * payment, so every tool is a read.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  ask: { access: "read" },
  ask_batch: { access: "read" },
};
