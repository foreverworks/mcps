
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerAgenda } from "./controllers/agenda.js";
import { registerEvents } from "./controllers/events.js";
import { registerFreeBusy } from "./controllers/freeBusy.js";

/** Calendar's tools, in one list. Adding a controller is one line. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [registerAgenda, registerEvents, registerFreeBusy]) register(server, registry);
};
