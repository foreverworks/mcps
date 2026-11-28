import { toolsetPolicy, toolsetsFrom, type ToolPolicy, type Toolsets } from "@foreverworks/mcp-kit";

/**
 * Toolsets (packages/mcp-kit toolsets.ts): TRADEMARKS_TOOLSETS, a
 * comma-separated list of the names below, loads only those tools. Unset,
 * blank or `all` loads every one, which is how every existing deployment runs.
 *
 * `search` is a server anyone can run for anyone: it searches the registers
 * that answer without a key (USPTO's search backend) and reads one mark from
 * them. `records` is the case-file side (a US mark's history and documents),
 * which needs a USPTO TSDR API key, so it is left out of a server that has none.
 */

/** The toolsets, in the order a person reads them; the error for an unknown name and the README list them so. */
export const TOOLSET_NAMES = ["search", "records"] as const;

export type Toolset = (typeof TOOLSET_NAMES)[number];

/** In every toolset's place, whatever is loaded: which sources work, and where any failure is diagnosed. */
export const ALWAYS: readonly string[] = ["health"];

/** Every other tool, and the one toolset it is in. */
export const TOOLSET_OF: Readonly<Record<string, Toolset>> = {
  search_marks: "search",
  get_mark: "search",
  mark_history: "records",
  mark_documents: "records",
  download_mark_documents: "records",
};

/** What the table gets wrong about `offered`, the tools this server registers: empty when it fits. */
export const toolsetGaps = (offered: readonly string[]): readonly string[] => {
  const placed = [...ALWAYS, ...Object.keys(TOOLSET_OF)];
  const missing = offered.filter((tool) => !placed.includes(tool));
  const stale = placed.filter((tool) => !offered.includes(tool));
  return [
    ...(missing.length === 0 ? [] : [`offered but in no toolset (place them in src/mcp/toolsets.ts): ${missing.join(", ")}`]),
    ...(stale.length === 0 ? [] : [`in a toolset but not offered (drop them): ${stale.join(", ")}`]),
  ];
};

/**
 * The toolsets TRADEMARKS_TOOLSETS names, and the policy of a server that
 * loads them: `full`'s rules for the tools always loaded and those of the
 * loaded toolsets, nothing else. Throws, stopping the server, when the table
 * does not fit `full` or the variable names a toolset there is not.
 */
export const loadToolsets = (full: ToolPolicy, env: NodeJS.ProcessEnv = process.env): { readonly loaded: readonly Toolset[]; readonly policy: ToolPolicy } => {
  const gaps = toolsetGaps(Object.keys(full));
  if (gaps.length > 0) throw new Error(`trademarks: src/mcp/toolsets.ts does not fit the tools offered; ${gaps.join("; ")}`);
  const rulesOf = (tools: readonly string[]): ToolPolicy => Object.fromEntries(tools.map((tool) => [tool, full[tool]!]));
  const toolsets = Object.fromEntries(
    TOOLSET_NAMES.map((name) => [name, rulesOf(Object.entries(TOOLSET_OF).filter(([, toolset]) => toolset === name).map(([tool]) => tool))]),
  ) as Toolsets<Toolset>;
  const loaded = toolsetsFrom(env, "TRADEMARKS_TOOLSETS", toolsets);
  return { loaded, policy: toolsetPolicy(rulesOf(ALWAYS), toolsets, loaded) };
};
