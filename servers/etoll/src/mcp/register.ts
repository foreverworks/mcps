import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerLogin } from "./controllers/login.js";
import { registerPurchase } from "./controllers/purchase.js";
import { registerReads } from "./controllers/reads.js";
import { handledFor } from "./envelope.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  const handled = handledFor(deps.loginScript);
  for (const register of [registerLogin, registerReads, registerPurchase]) register(server, deps, handled);
};
