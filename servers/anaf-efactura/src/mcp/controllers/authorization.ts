import { z } from "zod";

import { beginAuthorization, completeAuthorization } from "../../app/usecases/authorization.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

/**
 * Re-authorization through the MCP, so the agent never handles the grant. The
 * human step stays the certificate holder's: only they have the qualified certificate.
 */
export const registerAuthorization: Registrar = (server, deps) => {
  server.registerTool(
    "begin_authorization",
    {
      title: "Begin ANAF authorization",
      description:
        "Start (re)authorizing this server with ANAF when the grant is dead or about to end. Returns authorizeUrl " +
        "for the CERTIFICATE HOLDER to open in a browser with the qualified digital certificate; you cannot do that step. " +
        "Then call complete_authorization with the address the browser lands on, within 60 seconds of it landing. " +
        "Starting again replaces an earlier begun authorization.",
      inputSchema: {
        redirect_uri: z
          .string()
          .default("")
          .describe("One of the redirect URIs registered in app.json. Empty means the first one."),
      },
    },
    handled((args: { redirect_uri: string }) => beginAuthorization(deps, { redirectUri: args.redirect_uri })),
  );

  server.registerTool(
    "complete_authorization",
    {
      title: "Complete ANAF authorization",
      description:
        "Finish what begin_authorization started: exchanges ANAF's code for tokens and stores them where this " +
        "server keeps them. Pass the whole address the browser landed on as redirect_url (or code and state). " +
        "Answers only the two expiry dates; no token ever appears in the result. ANAF's code dies 60 seconds " +
        "after it is issued, so call this at once.",
      inputSchema: {
        redirect_url: z.string().default("").describe("The full address with ?code=...&state=... in it."),
        code: z.string().default("").describe("Only instead of redirect_url."),
        state: z.string().default("").describe("Only with code."),
      },
    },
    handled((args: { redirect_url: string; code: string; state: string }) =>
      completeAuthorization(deps, { redirectUrl: args.redirect_url, code: args.code, state: args.state }),
    ),
  );
};
