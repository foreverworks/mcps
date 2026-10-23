
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerAccounts } from "./controllers/accounts.js";
import { registerAuth } from "./controllers/auth.js";
import { registerBanks } from "./controllers/banks.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerBanks, registerAuth, registerAccounts]) {
    register(server, deps);
  }
};
