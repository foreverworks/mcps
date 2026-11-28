import { toolsetPolicy, toolsetsFrom, type ToolPolicy, type Toolsets } from "@foreverworks/mcp-kit";

import type { Mode } from "../app/ports.js";

/**
 * Toolsets (packages/mcp-kit toolsets.ts): ANAF_EFACTURA_TOOLSETS, a
 * comma-separated list of the names below, loads only those tools. Unset,
 * blank or `all` loads every one, which is how every existing deployment runs.
 *
 * The two that need no ANAF grant, `registry` and `documents`, are the whole of
 * a server run for anyone with no sign-in (MCP_HTTP_PUBLIC_HOSTS): they call
 * only ANAF's public host, or nothing at all, and write nothing, so the server
 * starts with no app.json and no state folder. Loading only them is what
 * `grantless` means (below); with any other toolset loaded, a grant is part of
 * the deployment and every tool keeps the parameters that use it.
 */

/** The toolsets, in the order a person reads them; the error for an unknown name and the README list them so. */
export const TOOLSET_NAMES = ["registry", "documents", "invoices", "etransport", "authorization"] as const;

export type Toolset = (typeof TOOLSET_NAMES)[number];

/** The toolsets whose tools call ANAF with the stored grant. */
export const GRANT_TOOLSETS: readonly Toolset[] = ["invoices", "etransport", "authorization"];

/** In every toolset's place, whatever is loaded: where a person starts, and where any failure is diagnosed. */
export const ALWAYS: readonly string[] = ["health"];

/** Every other tool, and the one toolset it is in. */
export const TOOLSET_OF: Readonly<Record<string, Toolset>> = {
  lookup_company: "registry",

  validate_invoice: "documents",
  parse_invoice: "documents",
  invoice_pdf: "documents",
  verify_signature: "documents",
  build_invoice: "documents",

  list_invoices: "invoices",
  list_invoices_window: "invoices",
  download_invoice: "invoices",
  upload_invoice: "invoices",
  upload_invoice_b2c: "invoices",
  upload_status: "invoices",

  etransport_list: "etransport",
  etransport_status: "etransport",
  etransport_file: "etransport",

  token_status: "authorization",
  refresh_token: "authorization",
  begin_authorization: "authorization",
  complete_authorization: "authorization",
};

/** What the table gets wrong about `offered`, the tools this server registers: empty when it fits. */
export const toolsetGaps = (offered: readonly string[]): readonly string[] => {
  const placed = [...ALWAYS, ...Object.keys(TOOLSET_OF)];
  return [
    [`offered but in no toolset (place them in src/mcp/toolsets.ts)`, offered.filter((tool) => !placed.includes(tool))],
    [`in a toolset but not offered (drop them)`, placed.filter((tool) => !offered.includes(tool))],
  ].flatMap(([what, tools]) => (tools!.length === 0 ? [] : [`${what}: ${(tools as string[]).join(", ")}`]));
};

/** The tools of one toolset, in the table's order. */
export const toolsOf = (toolset: Toolset): readonly string[] => Object.entries(TOOLSET_OF).filter(([, name]) => name === toolset).map(([tool]) => tool);

/** Every toolset loaded, an outbox: the server as every deployment before toolsets ran it. */
export const FULL_MODE: Mode = { grantless: false, outbox: true };

/**
 * What the server runs as with `loaded`. With no grant toolset there is no
 * state folder to keep an outbox in, so files come back inside the result,
 * unless ANAF_DOWNLOADS_DIR names an outbox on purpose.
 */
export const modeOf = (loaded: readonly Toolset[], env: NodeJS.ProcessEnv): Mode => {
  const grantless = !loaded.some((toolset) => GRANT_TOOLSETS.includes(toolset));
  return { grantless, outbox: !grantless || Boolean(env["ANAF_DOWNLOADS_DIR"]?.trim()) };
};

/**
 * The toolsets ANAF_EFACTURA_TOOLSETS names (every one when it is unset, blank
 * or `all`), and the policy of a server that loads them: `full`'s rules for the
 * tools always loaded and those of the loaded toolsets, nothing else. Throws,
 * stopping the server, when the table does not fit `full` or the variable names
 * a toolset there is not.
 */
export const loadToolsets = (
  full: ToolPolicy,
  env: NodeJS.ProcessEnv = process.env,
): { readonly loaded: readonly Toolset[]; readonly policy: ToolPolicy; readonly mode: Mode } => {
  const gaps = toolsetGaps(Object.keys(full));
  if (gaps.length > 0) throw new Error(`anaf-efactura: src/mcp/toolsets.ts does not fit the tools offered; ${gaps.join("; ")}`);
  const rulesOf = (tools: readonly string[]): ToolPolicy => Object.fromEntries(tools.map((tool) => [tool, full[tool]!]));
  const toolsets = Object.fromEntries(TOOLSET_NAMES.map((toolset) => [toolset, rulesOf(toolsOf(toolset))])) as Toolsets<Toolset>;
  const loaded = toolsetsFrom(env, "ANAF_EFACTURA_TOOLSETS", toolsets);
  return { loaded, policy: toolsetPolicy(rulesOf(ALWAYS), toolsets, loaded), mode: modeOf(loaded, env) };
};
