
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerLogin } from "./controllers/login.js";
import { registerRequests } from "./controllers/requests.js";
import { handledFor } from "./envelope.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  const handled = handledFor(deps.loginScript);
  for (const register of [registerLogin, registerRequests]) register(server, deps, handled);
};
