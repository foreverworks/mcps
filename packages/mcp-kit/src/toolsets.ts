import type { ToolPolicy, ToolRule } from "./policy.js";

/**
 * Toolsets: a server for several products loads only the products a client
 * asks for, the way GitHub's MCP server takes `GITHUB_TOOLSETS`
 * (github/github-mcp-server, "Tool Configuration"). Every tool definition a
 * client is handed rides along with every request it makes, so a client that
 * only reads mail should not pay for a hundred tools it never calls.
 *
 * A toolset is a part of the server's policy, named in lowercase snake_case
 * after the product it serves. One variable, `<SERVER>_TOOLSETS`, names the
 * ones to load, separated by commas. Unset, blank or holding `all`, it loads
 * every one, so a deployment that never sets it sees no change. A name that
 * is not a toolset stops the process at start, naming the ones there are,
 * like any setting the server cannot read (docs/configuration.md).
 *
 * A tool outside the loaded toolsets is not registered at all: absent from
 * tools/list, not listed and refusing (a ceiling, MCP_MAX_ACCESS, is what
 * lists a tool and refuses it). The tools every product needs (a server's
 * accounts, its health, its consent) belong to no toolset and are always
 * loaded. A tool several products share may sit in each of their toolsets,
 * with one rule object, and is loaded when any of them is.
 */

/** Toolset name -> its part of the policy, in the order a person reads them (the error and the docs list them so). */
export type Toolsets<N extends string = string> = Readonly<Record<N, ToolPolicy>>;

/** The value that loads every toolset, whatever else the list names. */
export const ALL_TOOLSETS = "all";

/**
 * The toolsets `variable` names, in the server's order: every one when it is
 * unset, blank or holds `all`. A name that is not a toolset is a plain throw,
 * since a process that would serve the wrong tools must not start.
 */
export const toolsetsFrom = <N extends string>(env: NodeJS.ProcessEnv, variable: string, toolsets: Toolsets<N>): readonly N[] => {
  const known = Object.keys(toolsets) as N[];
  if (Object.hasOwn(toolsets, ALL_TOOLSETS)) throw new Error(`${variable}: "${ALL_TOOLSETS}" cannot name a toolset; it loads every one`);
  const named = (env[variable] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (named.length === 0 || named.includes(ALL_TOOLSETS)) return known;
  const unknown = [...new Set(named.filter((name) => !Object.hasOwn(toolsets, name)))];
  if (unknown.length > 0) {
    const quoted = unknown.map((name) => `"${name}"`).join(", ");
    throw new Error(
      `${variable} names ${quoted}, which ${unknown.length === 1 ? "is not a toolset" : "are not toolsets"}: ` +
        `the toolsets are ${known.join(", ")}, or ${ALL_TOOLSETS} (the default)`,
    );
  }
  return known.filter((name) => named.includes(name));
};

/**
 * The policy a server runs with: the tools always loaded, and those of the
 * loaded toolsets. A tool in several toolsets keeps its one rule; a tool
 * given two different rules is a startup error, as in `mergePolicies`.
 */
export const toolsetPolicy = <N extends string>(always: ToolPolicy, toolsets: Toolsets<N>, loaded: readonly N[]): ToolPolicy => {
  const rules = new Map<string, ToolRule>();
  const twice = new Set<string>();
  for (const part of [always, ...loaded.map((name) => toolsets[name])]) {
    for (const [tool, rule] of Object.entries(part)) {
      const seen = rules.get(tool);
      if (seen !== undefined && seen !== rule) twice.add(tool);
      rules.set(tool, rule);
    }
  }
  if (twice.size > 0) throw new Error(`tools classified twice: ${[...twice].join(", ")}`);
  return Object.freeze(Object.fromEntries(rules));
};
