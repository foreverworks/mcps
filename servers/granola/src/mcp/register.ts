import { asFailure, type McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { beginAuthorization, completeAuthorization } from "../app/usecases/authorization.js";
import { callGranola } from "../app/usecases/forward.js";
import { health, refreshGrant } from "../app/usecases/health.js";
import { FALLBACK_LINES, KNOWN_TOOLS } from "../domain/tools.js";
import { handled, vocabulary } from "./envelope.js";
import { inputSchemaOf } from "./schemas.js";

const BEFORE_LISTING =
  "One of Granola's own tools, forwarded as it is. Its fields are those Granola publishes; they appear here once the grant has listed Granola's tools (health does it), until then any object is passed on and Granola checks it.";

/** The description of a forwarded tool before Granola's own has been listed. */
/** Granola's own text is shown to a model in every session: a runaway title or description from the cache is cut. */
const MAX_DESCRIPTION = 4000;
const MAX_TITLE = 200;
const capped = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`);

const describedBefore = (name: string): string => `${FALLBACK_LINES[name] ?? ""} ${BEFORE_LISTING}`.trim();

/**
 * The whole tool surface: four of this server's own, and Granola's read-only
 * tools under their own names, with the descriptions and input schemas Granola
 * last listed (the server builds its tools per request from what health or a
 * sign-in last saw, kept in the state directory).
 */
export const registerAll = (server: McpServer, deps: Deps): void => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server can serve Granola now: whether a grant exists and when its access token ends, whether Granola answers, which of Granola's tools are offered here, which Granola lists that are " +
        "deliberately withheld (the ones that write or touch the account), which are hidden until someone has read them, and which offered ones Granola no longer lists. " +
        "Read-only: it never refreshes the grant (refresh_grant does). Never prints a token. Start here; it also refreshes the tool list.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "refresh_grant",
    {
      title: "Refresh the Granola grant",
      description: "Refreshes the grant now, to prove the refresh token still works. The new tokens are saved before they are used. Calls refresh a due token by themselves; use this to check, not to keep the grant alive. A failure says whether the grant is gone (sign in again) or Granola is only unwell (retry).",
      inputSchema: {},
    },
    handled(() => refreshGrant(deps)),
  );

  server.registerTool(
    "begin_authorization",
    {
      title: "Begin signing in to Granola",
      description:
        "Step one of connecting a Granola account, done once per deployment (and again if the grant is lost or revoked). Registers this server with Granola's sign-in service when needed and returns authorize_url, which the account's owner opens in a browser " +
        "where they are signed in to Granola. The browser then lands on an address with ?code=...&state=... (the page may fail to load; the address is what matters). Pass it to complete_authorization within ten minutes.",
      inputSchema: {},
    },
    handled(() => beginAuthorization(deps)),
  );

  server.registerTool(
    "complete_authorization",
    {
      title: "Finish signing in to Granola",
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
      { title: capped(spec?.title ?? name, MAX_TITLE), description: capped(spec?.description ?? describedBefore(name), MAX_DESCRIPTION), inputSchema: inputSchemaOf(spec) },
      async (args: Record<string, unknown>) => {
        try {
          return (await callGranola(deps, name, args)) as never;
        } catch (thrown) {
          return asFailure(thrown, vocabulary);
        }
      },
    );
  }
};
