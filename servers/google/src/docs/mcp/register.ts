
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerApi } from "./controllers/api.js";
import { registerDocuments } from "./controllers/documents.js";

/** Docs' tools. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [registerDocuments, registerApi]) register(server, registry);
};
