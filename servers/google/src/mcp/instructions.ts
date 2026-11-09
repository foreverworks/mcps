import { listed } from "../domain/words.js";
import type { Toolset } from "./policy.js";

/**
 * What the server tells a client at initialize, before any tool description:
 * what it serves, where to start, and the rules no single tool description
 * carries (which account a call reaches, what may be sent). A client sends it
 * with every session, so it says only that; each tool's own description says
 * the rest. Built from the loaded toolsets (GOOGLE_TOOLSETS), so it never names
 * a tool the client was not handed (test/toolsets.test.ts holds it to that).
 */
export const instructionsFor = (loaded: readonly Toolset[]): string => {
  const has = (toolset: Toolset): boolean => loaded.includes(toolset);
  const only = (pairs: readonly (readonly [Toolset, string])[]): readonly string[] => pairs.flatMap(([toolset, text]) => (has(toolset) ? [text] : []));
  const editors = only([["docs", "Docs"], ["sheets", "Sheets"], ["slides", "Slides"]]);

  // Docs, Sheets and Slides are one item of the list; comments and sharing are named only when no editor already brings a file.
  const products = [
    ...only([["gmail", "Gmail"], ["calendar", "Calendar"], ["drive", "a Drive"]]),
    ...(editors.length > 0 ? [listed(editors, "and")] : has("collaboration") ? ["comments, sharing and revisions on Drive files"] : []),
    ...only([["tasks", "Google Tasks"], ["contacts", "contacts with a Workspace directory"], ["meet", "Meet's transcripts"]]),
  ];
  const acrossAccounts = only([["gmail", "search_threads"], ["calendar", "agenda"], ["calendar", "free_busy"], ["tasks", "list_tasks"], ["contacts", "find_people"]]);
  const writes = `every write names its account${has("drive") ? " (Drive tools take none)" : ""}.`;
  const sends = only([["gmail", "send_message, send_draft, reply or forward with send"], ["collaboration", "share_file"]]);

  return [
    `Several Google accounts through one server: ${listed(products, "and", true)}.`,
    "Start with list_accounts: one account label is one identity in every product.",
    acrossAccounts.length > 0 ? `${listed(acrossAccounts, "and")} read every account when none is given; ${writes}` : `${writes[0]?.toUpperCase()}${writes.slice(1)}`,
    ...(sends.length === 0
      ? []
      : [
          `${has("gmail") ? "For mail, create_draft is the default: " : ""}${sends.join(", and ")} ` +
            `${has("gmail") ? "act" : "acts"} only on the user's explicit go for that ${listed(only([["gmail", "message"], ["collaboration", "file"]]), "or")}.`,
        ]),
    ...(editors.length > 0 ? ["Before any batch_update_* call, editors_api_reference says what each request takes."] : []),
    "When a grant is missing or lapsed, begin_consent gives the account's owner a link to open, and complete_consent takes the address it lands on.",
  ].join(" ");
};
