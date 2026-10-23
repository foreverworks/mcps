import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts). A lease changes who may
 * use a phone and can start or reset a simulator, so the calls that change one
 * are writes; nothing here moves money. resume sets a state (not paused), so
 * calling it twice changes nothing more: it is idempotent.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  status: { access: "read" },
  acquire: { access: "write" },
  wait: { access: "write" },
  renew: { access: "write" },
  pause: { access: "write" },
  resume: { access: "write", idempotent: true },
  release: { access: "write" },
  report: { access: "write" },
  clear: { access: "write" },
};
