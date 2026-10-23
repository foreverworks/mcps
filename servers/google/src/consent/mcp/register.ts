import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { beginConsent, completeConsent } from "../app/consent.js";
import { CONSENT_PRODUCTS, type ConsentProduct } from "../domain/consent.js";
import { handled } from "./envelope.js";

/** The two consent tools: the server's, not a product's, like list_accounts and health. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "begin_consent",
    {
      title: "Begin a Google consent",
      description:
        "Start granting one product access to one account: gmail (its own gmail.modify grant), calendar, editors " +
        "(Docs, Sheets, Slides), drive (Drive's one grant), tasks (Google Tasks), contacts (contacts, saved addresses " +
        "and a Workspace directory, read only) or meet (Meet records and transcripts, read only). Returns the URL to open in a browser, where the user " +
        "approves as the account named. The redirect then fails to load; pass the URL it tried to complete_consent " +
        "within 15 minutes. No token ever leaves the server.",
      inputSchema: {
        product: z.enum(CONSENT_PRODUCTS),
        account: z.string().min(1).describe("The account label, as list_accounts names it."),
        grant: z.enum(["modify"]).optional().describe("Gmail only: the grant to consent. modify is the only one this server holds."),
      },
    },
    handled((args: { product: ConsentProduct; account: string }) => beginConsent(deps, { product: args.product, account: args.account })),
  );

  server.registerTool(
    "complete_consent",
    {
      title: "Complete a Google consent",
      description:
        "Finish a consent from the URL the approval redirected to (http://localhost:...?state=...&code=...). The " +
        "grant is checked (the right account, every scope ticked, a refresh token) and saved where the product " +
        "reads it, and the product uses it from the next call. Returns what was granted, never a token.",
      inputSchema: { redirect_url: z.string().min(1).describe("The whole URL from the browser's address bar.") },
    },
    handled((args: { redirect_url: string }) => completeConsent(deps, { redirectUrl: args.redirect_url })),
  );
};
