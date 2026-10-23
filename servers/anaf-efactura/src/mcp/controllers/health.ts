import { z } from "zod";

import { checkHealth } from "../../app/usecases/health.js";
import { refreshTokens, tokenStatus } from "../../app/usecases/tokens.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerHealth: Registrar = (server, deps) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the integration is alive and say so in detail: the ANAF app it authenticates as, " +
        "the CIF it defaults to, the roles the grant carries, and how many days are left on each token. " +
        "Run this before concluding the MCP is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "token_status",
    {
      title: "Token status",
      description:
        "Report on the stored OAuth tokens without contacting ANAF and without refreshing. " +
        "Watch refreshTokenRemainingDays: once it reaches zero the grant can only be restored by hand, " +
        "at a browser, with the qualified certificate.",
      inputSchema: {},
    },
    handled(() => tokenStatus(deps)),
  );

  server.registerTool(
    "refresh_token",
    {
      title: "Refresh the access token",
      description:
        "Mint a new access token. Does nothing while the current one still has its three-day cushion " +
        "unless force is set, because every refresh also ROTATES the refresh token and the old one dies " +
        "with it. Safe to call on a schedule; pointless to call in a loop.",
      inputSchema: {
        force: z.boolean().default(false).describe("Refresh even when the access token has time left."),
      },
    },
    handled((args: { force: boolean }) => refreshTokens(deps, { force: args.force })),
  );
};
