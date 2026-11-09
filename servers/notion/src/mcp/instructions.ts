/**
 * The server's instructions, naming the workspaces the token files named at
 * start. The labels are the deployment's (one file per workspace); none is
 * known to this code, and with none configured the text says how many there
 * can be instead. A client sends this with every session, so it holds what to
 * start with and the rules no single tool description carries.
 */
export const instructionsFor = (labels: readonly string[]): string =>
  `${labels.length === 0 ? "Notion workspaces, one per integration token" : `Notion workspaces ${labels.map((l) => `"${l}"`).join(", ")}`}, through one server; ` +
  "any page or database id or Notion URL finds its own workspace. Start with search. Before querying or writing rows, " +
  "describe_database names a database's columns. When a person names a saved view, list_views finds it and query_view reads its " +
  "rows as Notion shows them. Only pages shared with the integration are visible.";
