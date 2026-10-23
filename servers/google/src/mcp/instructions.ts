import { listed } from "../domain/words.js";
import type { Toolset } from "./policy.js";

/**
 * What the server tells a client at initialize, before any tool description:
 * what it serves and where to start. Built from the loaded toolsets
 * (GOOGLE_TOOLSETS), so it never names a tool the client was not handed; with
 * every toolset loaded it is the text the server has always given, word for
 * word (test/toolsets.test.ts holds it to that).
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
  const writes = `every write names its account, because there is no default for one${has("drive") ? ", and Drive tools take none" : ""}.`;
  const sends = only([["gmail", "send_message, send_draft, reply or forward with send"], ["collaboration", "share_file"]]);
  const filesOut = only([["gmail", "get_attachment"], ["gmail", "harvest_attachments"], ["drive", "download_file"]]);

  return [
    `Several Google accounts through one server: ${listed(products, "and", true)}.`,
    "Start with list_accounts: it names each account label (one label is one identity in every product) and which products reach it.",
    acrossAccounts.length > 0 ? `The reads that make sense across accounts (${acrossAccounts.join(", ")}) read every account when none is given; ${writes}` : `${writes[0]?.toUpperCase()}${writes.slice(1)}`,
    ...(has("contacts") ? ["To address someone by name, find_people finds the address."] : []),
    ...(sends.length === 0
      ? []
      : [
          `${has("gmail") ? "For mail, create_draft is the default for anything addressed to someone: " : ""}${sends.join(", and ")} ` +
            `${has("gmail") ? "act" : "acts"} only on the user's explicit go for that ${listed(only([["gmail", "message"], ["collaboration", "file"]]), "or")}.`,
        ]),
    ...(has("docs") ? ["In Docs, read_document comes before edit_document_section, which is pinned to the revision read; before any batch_update_* call, editors_api_reference says what each request takes."] : []),
    ...(!has("docs") && editors.length > 0 ? ["Before any batch_update_* call, editors_api_reference says what each request takes."] : []),
    ...(has("meet") ? [`A meeting's transcript and notes: list_meetings (from ${has("calendar") ? "an agenda event" : "a Meet link or the last days"}), then get_transcript.`] : []),
    ...(filesOut.length > 0
      ? [`Files come back through the server's outbox with their SHA-256 (${filesOut.join(", ")})${has("drive") ? " and go in by path (upload_file)" : ""}.`]
      : []),
    "When health or a tool says a grant is missing or lapsed, begin_consent returns the link the account's owner opens, and complete_consent takes the address it lands on.",
  ].join(" ");
};
