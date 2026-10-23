/**
 * The server's instructions, naming the workspaces the token files named at
 * start. The labels are the deployment's (one file per workspace); none is
 * known to this code, and with none configured the text says how many there
 * can be instead.
 */
export const instructionsFor = (labels: readonly string[]): string =>
  `${labels.length === 0 ? "Notion workspaces, one per integration token" : `Notion workspaces ${labels.map((l) => `"${l}"`).join(", ")}`}, through one server. ` +
  "Any page or database id or Notion URL finds its own workspace, so account is rarely needed; search covers every workspace. " +
  "Start with search to find a page or a database, describe_database before querying or writing rows (where, sort and properties " +
  "name its columns), read_page for a page's properties and Markdown body. When a person names a saved view (\"my Active list\"), " +
  "list_views finds it and query_view reads its rows as Notion shows them. Only pages the token can see are visible.";
