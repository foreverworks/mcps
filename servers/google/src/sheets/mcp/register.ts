
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerApi } from "./controllers/api.js";
import { registerCells } from "./controllers/cells.js";
import { registerRows } from "./controllers/rows.js";

/** Sheets' tools. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [registerRows, registerCells, registerApi]) register(server, registry);
};
