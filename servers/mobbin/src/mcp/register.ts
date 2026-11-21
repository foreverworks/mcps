import { asFailure, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { beginAuthorization, completeAuthorization } from "../app/usecases/authorization.js";
import { callMobbin } from "../app/usecases/forward.js";
import { health } from "../app/usecases/health.js";
import { KNOWN_TOOLS } from "../domain/tools.js";
import { handled, vocabulary } from "./envelope.js";
import { inputSchemaOf } from "./schemas.js";

const BEFORE_LISTING =
  "One of Mobbin's own tools, forwarded as it is. Its fields are those Mobbin publishes; they appear here once the grant has listed Mobbin's tools (health does it), until then any object is passed on and Mobbin checks it.";

/**
 * The whole tool surface: three of this server's own, and Mobbin's classified
 * tools under their own names, with the descriptions and input schemas Mobbin
 * last listed (the server builds its tools per request from what health or a
 * sign-in last saw, kept in the state directory).
 */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server can serve Mobbin now: whether a grant exists and when its access token ends, whether a refresh works, whether Mobbin answers, and which of Mobbin's tools are offered here, which Mobbin lists " +
        "that are not (hidden until classified), and which classified ones Mobbin no longer lists. Never prints a token. Start here; it also refreshes the tool list. A refresh is tried when the access token is due, or when test_refresh is true.",
      inputSchema: { test_refresh: z.boolean().default(false).describe("Refresh the grant now to prove the refresh token works. It rotates the grant, which is safe.") },
    },
    handled((a: { test_refresh: boolean }) => health(deps, { testRefresh: a.test_refresh })),
  );

  server.registerTool(
    "begin_authorization",
    {
      title: "Begin signing in to Mobbin",
      description:
        "Step one of connecting a Mobbin account, done once per deployment (and again if the grant is lost or revoked). Registers this server with Mobbin's sign-in service when needed and returns authorize_url, which the account's owner opens in a browser " +
        "where they are signed in to Mobbin. The browser then lands on an address with ?code=...&state=... (the page may fail to load; the address is what matters). Pass it to complete_authorization within ten minutes.",
      inputSchema: {},
    },
    handled(() => beginAuthorization(deps)),
  );

  server.registerTool(
    "complete_authorization",
    {
      title: "Finish signing in to Mobbin",
      description:
        "Step two: takes the whole address the browser landed on after begin_authorization (redirect_url), or just its code, checks it belongs to the sign-in begun, exchanges it once and stores the grant. " +
        "Answers when the access token ends; this server then refreshes it by itself.",
      inputSchema: {
        redirect_url: z.string().trim().min(1).optional().describe("The whole address the browser landed on, with ?code=...&state=... in it."),
        code: z.string().trim().min(1).optional().describe("Only the code, when the address is not to hand. Prefer redirect_url: it carries the state, which is checked."),
      },
    },
    handled((a: { redirect_url?: string | undefined; code?: string | undefined }) => completeAuthorization(deps, { redirectUrl: a.redirect_url, code: a.code })),
  );

  const known = deps.knownTools();
  for (const name of KNOWN_TOOLS) {
    const spec = known.find((t) => t.name === name);
    server.registerTool(
      name,
      { title: spec?.title ?? name, description: spec?.description ?? BEFORE_LISTING, inputSchema: inputSchemaOf(spec) },
      async (args: Record<string, unknown>) => {
        try {
          return (await callMobbin(deps, name, args)) as never;
        } catch (thrown) {
          return asFailure(thrown, vocabulary);
        }
      },
    );
  }
};
