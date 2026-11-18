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
        "Whether this server is configured and holds a portal session (none, present, expired), how it signed in, and where the password and the authenticator code come from. No network. Run it before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Is an account signed in: who, when the tokens expire, and what to do if not. With probe, mints once to prove the session works: a refresh, or a sign-in with the configured password, which also lifts the pause after a refused one. Never shows a token.",
      inputSchema: { probe: z.boolean().default(false).describe("Refresh (or sign in) once to prove the session works.") },
    },
    handled((args) => sessionStatus(deps, { probe: args.probe })),
  );

  server.registerTool(
    "begin_login",
    {
      title: "Begin login",
      description:
        'Sign in. method "password": the server fills the portal\'s own form with the configured e-mail and password and, when it can read the authenticator code (a vault, a TOTP secret), finishes by itself; ' +
        'otherwise it answers needs_code: ask the user for the six digits and call complete_login with otp. method "roeid": answers with a URL the USER opens in a real browser, ' +
        "signs in with ROeID and approves on their phone; the address the browser lands on goes to complete_login as redirect_url. Call this when a tool answers needs_login.",
      inputSchema: { method: z.enum(["password", "roeid"]).default("password").describe("password: the portal's own form; roeid: ROeID, in the user's browser.") },
    },
    handled((args) => beginLogin(deps, { method: args.method })),
  );

  server.registerTool(
    "complete_login",
    {
      title: "Complete login",
      description:
        "Finish a begun login, with exactly one of: otp, the six digits of the authenticator app after a password sign-in answered needs_code (within 5 minutes); or redirect_url, the whole address the browser landed on " +
        "after ROeID (it carries code=... and state=...; the code dies within a minute). Stores the session in the server's own state and answers who signed in.",
      inputSchema: {
        otp: z.string().trim().min(1).optional().describe("The authenticator app's six digits, after begin_login answered needs_code."),
        redirect_url: z.string().trim().min(1).optional().describe("The whole address the browser landed on after a ROeID sign-in."),
      },
    },
    handled((args) => completeLogin(deps, { otp: args.otp, redirectUrl: args.redirect_url })),
  );

  server.registerTool(
    "logout",
    {
      title: "Logout",
      description:
        "Forget the stored session and tell Keycloak it is over. The user's own browser sign-in is not touched. With a password configured, the next call that needs the portal signs in again.",
      inputSchema: {},
    },
    handled(() => logout(deps)),
  );
};
