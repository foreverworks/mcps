import { z } from "zod";

import { health } from "../../app/usecases/health.js";
import { beginLogin, completeLogin, logout, sessionStatus } from "../../app/usecases/login.js";
import type { Registrar } from "./types.js";

export const registerLogin: Registrar = (server, deps, handled) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description: "Whether this server is configured and holds a portal session (none, present, expired). No network. Run it before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Is a portal account signed in through this server: who, when the access and refresh tokens expire, and what to do if not. " +
        "With probe, refreshes once to prove the session is still honoured by Keycloak. Never shows a token.",
      inputSchema: { probe: z.boolean().default(false).describe("Refresh once to prove the session still works.") },
    },
    handled((args) => sessionStatus(deps, { probe: args.probe })),
  );

  server.registerTool(
    "begin_login",
    {
      title: "Begin login",
      description:
        "Start signing in: answers with a URL the USER opens in the browser where they are already signed in to myportal.onrc.ro " +
        "(Keycloak answers from that sign-in; no password or code is typed), and the redirect it ends on. Pass that address to complete_login. " +
        "Open for 15 minutes; beginning again replaces it. Call this whenever a tool answers needs_login.",
      inputSchema: {},
    },
    handled(() => beginLogin(deps)),
  );

  server.registerTool(
    "complete_login",
    {
      title: "Complete login",
      description:
        "Finish a begun login from the address the browser landed on (it carries code=... and state=...). Exchanges the code and stores the session " +
        "in the service's own state; answers with who signed in and when the session expires. The code dies within a minute of being issued, so pass it at once.",
      inputSchema: { redirect_url: z.string().trim().min(1).describe("The whole address the browser landed on after the login.") },
    },
    handled((args) => completeLogin(deps, { redirectUrl: args.redirect_url })),
  );

  server.registerTool(
    "logout",
    {
      title: "Logout",
      description: "Forget the stored session and tell Keycloak it is over. The user's own browser sign-in is not touched. Reads will answer needs_login until the next login.",
      inputSchema: {},
    },
    handled(() => logout(deps)),
  );
};
