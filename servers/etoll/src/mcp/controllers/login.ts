import { z } from "zod";

import { health } from "../../app/usecases/health.js";
import { beginLogin, completeLogin, logout, sessionStatus } from "../../app/usecases/login.js";
import type { Registrar } from "./types.js";

export const registerLogin: Registrar = (server, deps, handled) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server is configured: the eToll session it holds (none, present, expired), how it signed in, and where a password comes from if one is configured (never the password). " +
        "No network. Run it before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Is an eToll account signed in through this server: who, when the tokens expire, and what to do if not. With probe, refreshes once (or signs in with the configured " +
        "password) to prove the session works; after a refused password, probe is also how to try again at once. Never shows a token.",
      inputSchema: { probe: z.boolean().default(false).describe("Refresh, or sign in with the password, once to prove the session works.") },
    },
    handled((args) => sessionStatus(deps, { probe: args.probe })),
  );

  server.registerTool(
    "begin_login",
    {
      title: "Begin login",
      description:
        "Sign in through the browser, for an account without a password configured here: answers with a URL the USER opens and signs in to eToll at " +
        "(their password never reaches this conversation), and the address it ends on. Pass that address to complete_login. Open for 15 minutes; beginning again " +
        "replaces it. Call this when a tool answers needs_login.",
      inputSchema: {},
    },
    handled(() => beginLogin(deps)),
  );

  server.registerTool(
    "complete_login",
    {
      title: "Complete login",
      description:
        "Finish a begun browser sign-in from the address the browser landed on (it carries code=... and state=...). Exchanges the code and stores the session in the " +
        "server's own state; answers with who signed in and when the session expires. The code dies within a minute of being issued, so pass it at once.",
      inputSchema: { redirect_url: z.string().trim().min(1).describe("The whole address the browser landed on after signing in.") },
    },
    handled((args) => completeLogin(deps, { redirectUrl: args.redirect_url })),
  );

  server.registerTool(
    "logout",
    {
      title: "Logout",
      description:
        "Forget the stored session and tell Keycloak it is over. The user's own browser sign-in is not touched. With a password configured, the next call signs in again.",
      inputSchema: {},
    },
    handled(() => logout(deps)),
  );
};
