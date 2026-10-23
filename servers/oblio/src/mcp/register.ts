
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerDocuments } from "./controllers/documents.js";
import { registerNomenclature } from "./controllers/nomenclature.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerNomenclature, registerDocuments]) {
    register(server, deps);
  }
};
