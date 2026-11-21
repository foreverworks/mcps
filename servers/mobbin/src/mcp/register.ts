import { asFailure, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { beginAuthorization, completeAuthorization } from "../app/usecases/authorization.js";
import { callMobbin } from "../app/usecases/forward.js";
import { health, refreshGrant } from "../app/usecases/health.js";
import { KNOWN_TOOLS } from "../domain/tools.js";
import { handled, vocabulary } from "./envelope.js";
import { inputSchemaOf } from "./schemas.js";

const BEFORE_LISTING =
  "One of Mobbin's own tools, forwarded as it is. Its fields are those Mobbin publishes; they appear here once the grant has listed Mobbin's tools (health does it), until then any object is passed on and Mobbin checks it.";

/**
 * The whole tool surface: four of this server's own, and Mobbin's classified
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
        "Whether this server can serve Mobbin now: whether a grant exists and when its access token ends, whether Mobbin answers, and which of Mobbin's tools are offered here, which Mobbin lists " +
        "that are not (hidden until classified), and which classified ones Mobbin no longer lists. Read-only: it never refreshes the grant (refresh_grant does). Never prints a token. Start here; it also refreshes the tool list.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "refresh_grant",
    {
      title: "Refresh the Mobbin grant",
      description: "Refreshes the grant now, to prove the refresh token still works. The new tokens are saved before they are used. Calls refresh a due token by themselves; use this to check, not to keep the grant alive. A failure says whether the grant is gone (sign in again) or Mobbin is only unwell (retry).",
      inputSchema: {},
    },
    handled(() => refreshGrant(deps)),
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
        "Step two: takes the whole address the browser landed on after begin_authorization (redirect_url), checks its state belongs to the sign-in begun, exchanges its code once and stores the grant. " +
        "Answers when the access token ends; this server then refreshes it by itself.",
      inputSchema: { redirect_url: z.string().trim().min(1).describe("The whole address the browser landed on, with ?code=...&state=... in it. The state is always checked, so a bare code is not taken.") },
    },
    handled((a: { redirect_url: string }) => completeAuthorization(deps, { redirectUrl: a.redirect_url })),
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
