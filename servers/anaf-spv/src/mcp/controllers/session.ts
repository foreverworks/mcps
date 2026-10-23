import { z } from "zod";

import { health } from "../../app/usecases/health.js";
import { completeLogin, login, logout, sessionStatus } from "../../app/usecases/session.js";
import type { Registrar } from "./types.js";

export const registerSession: Registrar = (server, deps, handled) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Whether this server can work: where the SPV credential comes from (a vault MCP, a file, or none), which mail driver reads the e-mailed code " +
        "(google, text, auto or manual), whether a session is stored and whether a sign-in waits for its code. No network: it never signs in. Run it first, " +
        "and before concluding the server is broken.",
      inputSchema: {},
    },
    handled(() => health(deps)),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Is a session stored, since when, and when it last worked; with probe, loads one SPV page to prove SPV still honours it. Never signs in " +
        "(every other tool signs in by itself when it needs to).",
      inputSchema: { probe: z.boolean().default(false).describe("Load one page to prove the session is alive.") },
    },
    handled((args) => sessionStatus(deps, { probe: args.probe })),
  );

  server.registerTool(
    "login",
    {
      title: "Sign in",
      description:
        "Sign in to SPV now. Rarely needed: every tool signs in by itself when the session is missing or has ended. The server reads the password from " +
        "its credential source, SPV e-mails a security code, and the mail driver reads it from the mailbox; the answer says signed_in. When no mail " +
        "driver can read it (manual, or the code did not come in time) the answer says awaiting_code with a deadline: read the newest \"Cod de " +
        "siguranta\" mail from Autentificare.SpatiuPrivat@anaf.ro and pass its digits to complete_login. Each sign-in e-mails the user a code.",
      inputSchema: {
        force: z.boolean().default(false).describe("Sign in again even when the stored session still works."),
        code_by_hand: z.boolean().default(false).describe("Do not read the code from the mailbox: stop at awaiting_code and wait for complete_login."),
      },
    },
    handled((args) => login(deps, { force: args.force, byHand: args.code_by_hand })),
  );

  server.registerTool(
    "complete_login",
    {
      title: "Complete sign-in",
      description:
        "Finish a sign-in that waits for its code (login answered awaiting_code, or a tool failed with needs_login): pass the digits of the newest " +
        "\"Cod de siguranta\" mail. SPV honours a code for five minutes; only the newest code works.",
      inputSchema: { code: z.string().trim().min(4).max(20).describe("The security code from the mail, e.g. 246810.") },
    },
    handled((args) => completeLogin(deps, { code: args.code })),
  );

  server.registerTool(
    "logout",
    {
      title: "Sign out",
      description: "Sign out at SPV and forget the session here. The next tool that needs SPV signs in again (and SPV e-mails a new code).",
      inputSchema: {},
    },
    handled(() => logout(deps)),
  );
};
