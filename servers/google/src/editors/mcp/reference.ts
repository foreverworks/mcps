import { makeHandled, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { DOCS_API } from "../../docs/domain/api.js";
import { SHEETS_API } from "../../sheets/domain/api.js";
import { SLIDES_API } from "../../slides/domain/api.js";
import { listed } from "../../domain/words.js";
import { reference } from "../domain/discovery.js";
import { asAppError, fail, notFoundError, remedyFor } from "../domain/errors.js";

const APIS = { docs: DOCS_API, sheets: SHEETS_API, slides: SLIDES_API } as const;

export type EditorApi = keyof typeof APIS;

/** Every editor, in the order the texts name them. */
export const EDITOR_APIS: readonly EditorApi[] = ["docs", "sheets", "slides"];

/** Each editor's words in the description: its name, its batch tool, and an example request kind and type. */
const WORDS: Readonly<Record<EditorApi, { readonly name: string; readonly batch: string; readonly kind: string; readonly type: string }>> = {
  docs: { name: "Docs", batch: "batch_update_document", kind: "updateTextStyle", type: "TextStyle" },
  sheets: { name: "Sheets", batch: "batch_update_spreadsheet", kind: "repeatCell", type: "CellFormat" },
  slides: { name: "Slides", batch: "batch_update_presentation", kind: "createShape", type: "PageElementProperties" },
};

const handled = makeHandled({ asAppError, remedyFor });

/**
 * The reference the batch tools point to: the API's own schema, read from the
 * Discovery document they check requests against, so what it says a request
 * takes is exactly what the check accepts. No account, no network. It names
 * only the editors loaded (GOOGLE_TOOLSETS), with all three it reads as it
 * always has, and with none it is not registered.
 */
export const registerReference = (server: McpServer, apis: readonly EditorApi[] = EDITOR_APIS): void => {
  const words = apis.map((api) => WORDS[api]);
  const [first, ...rest] = apis;
  if (first === undefined) return;
  server.registerTool(
    "editors_api_reference",
    {
      title: `${listed(words.map((w) => w.name), "and")} API reference`,
      description:
        `What a Google ${listed(words.map((w) => w.name), "or")} batchUpdate request takes, from the API's own schema (the revision ` +
        `${listed(words.map((w) => w.batch), "and")} ${words.length === 1 ? "checks" : "check"} against): each field's type, ` +
        "allowed values and meaning, with the types it refers to expanded `depth` levels down (`more` lists the rest by name). " +
        `Name a request kind (${words.map((w) => w.kind).join(", ")}) or any type (${words.map((w) => w.type).join(", ")}); ` +
        "with no name, every request kind and its one-line summary. Kinds marked Developer Preview need the Cloud project in Google's preview program.",
      inputSchema: {
        api: z.enum([first, ...rest]),
        name: z.string().default("").describe("A request kind or a type name. Empty lists the request kinds."),
        depth: z.number().int().min(0).max(4).default(1).describe("How many levels of referred types to expand."),
      },
    },
    handled(async (args: { api: EditorApi; name: string; depth: number }) => {
      const answer = reference(APIS[args.api], args.name, args.depth);
      return "unknown" in answer ? fail(notFoundError(answer.unknown)) : answer;
    }),
  );
};
