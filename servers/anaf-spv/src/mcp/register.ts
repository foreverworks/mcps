
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerContact } from "./controllers/contact.js";
import { registerDeclarations } from "./controllers/declarations.js";
import { registerMessages } from "./controllers/messages.js";
import { registerRequests } from "./controllers/requests.js";
import { registerSession } from "./controllers/session.js";
import { handled } from "./envelope.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerSession, registerMessages, registerRequests, registerContact, registerDeclarations]) register(server, deps, handled);
};
