import { z } from "zod";

import { checkHealth, listAspsps } from "../../app/usecases/banks.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerBanks: Registrar = (server, deps) => {
  server.registerTool(
    "health",
    {
      title: "Health",
      description:
        "Check that the integration is alive and say so in detail: the Enable Banking application the " +
        "key pair authenticates as, its environment and redirect URL, where the config, key and sessions are, " +
        "and how many consents are stored. Run this before concluding the MCP is broken.",
      inputSchema: {},
    },
    handled(() => checkHealth(deps)),
  );

  server.registerTool(
    "list_aspsps",
    {
      title: "List banks",
      description:
        "List the banks Enable Banking can reach, by two-letter country code. The name field is what " +
        "start_auth takes, psuTypes says whether the bank exposes personal accounts, business accounts or " +
        "both, and maxConsentDays is how long that bank will let a consent last. Pass an empty country for " +
        "every bank in every market. Served from a one-hour cache.",
      inputSchema: {
        country: z
          .string()
          .regex(/^([A-Za-z]{2})?$/, "a two-letter country code, or empty for every market")
          .describe("Two-letter code, like RO. Empty means every market, a large answer."),
      },
    },
    handled((args: { country: string }) => listAspsps(deps, args)),
  );
};
