
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerApi } from "./controllers/api.js";
import { registerDecks } from "./controllers/decks.js";

/** Slides' tools. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [registerDecks, registerApi]) register(server, registry);
};
