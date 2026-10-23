import { makeHandled, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { DOCS_API } from "../../docs/domain/api.js";
import { SHEETS_API } from "../../sheets/domain/api.js";
import { SLIDES_API } from "../../slides/domain/api.js";
import { reference } from "../domain/discovery.js";
import { asAppError, fail, notFoundError, remedyFor } from "../domain/errors.js";

const APIS = { docs: DOCS_API, sheets: SHEETS_API, slides: SLIDES_API } as const;

const handled = makeHandled({ asAppError, remedyFor });

/**
 * The reference the three batch tools point to: the API's own schema, read
 * from the Discovery document they check requests against, so what it says a
 * request takes is exactly what the check accepts. No account, no network.
 */
export const registerReference = (server: McpServer): void => {
  server.registerTool(
    "editors_api_reference",
    {
      title: "Docs, Sheets and Slides API reference",
      description:
        "What a Google Docs, Sheets or Slides batchUpdate request takes, from the API's own schema (the revision " +
        "batch_update_document, batch_update_spreadsheet and batch_update_presentation check against): each field's type, " +
        "allowed values and meaning, with the types it refers to expanded `depth` levels down (`more` lists the rest by name). " +
        "Name a request kind (updateTextStyle, repeatCell, createShape) or any type (TextStyle, CellFormat, PageElementProperties); " +
        "with no name, every request kind and its one-line summary. Kinds marked Developer Preview need the Cloud project in Google's preview program.",
      inputSchema: {
        api: z.enum(["docs", "sheets", "slides"]),
        name: z.string().default("").describe("A request kind or a type name. Empty lists the request kinds."),
        depth: z.number().int().min(0).max(4).default(1).describe("How many levels of referred types to expand."),
      },
    },
    handled(async (args: { api: keyof typeof APIS; name: string; depth: number }) => {
      const answer = reference(APIS[args.api], args.name, args.depth);
      return "unknown" in answer ? fail(notFoundError(answer.unknown)) : answer;
    }),
  );
};
