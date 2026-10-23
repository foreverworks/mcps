import type { ToolPolicy } from "@foreverworks/mcp-kit";

/** Consent's tools, classified (packages/mcp-kit policy.ts): each changes which grant a product runs on. */
export const CONSENT: ToolPolicy = {
  begin_consent: { access: "write" },
  complete_consent: { access: "write" },
};
