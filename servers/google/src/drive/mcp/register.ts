
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerBrowse } from "./controllers/browse.js";
import { registerContent } from "./controllers/content.js";
import { registerDownload } from "./controllers/download.js";
import { registerOrganise } from "./controllers/organise.js";
import { registerSync } from "./controllers/sync.js";
import { registerUpload } from "./controllers/upload.js";

/** Drive's tools, in one list. Adding a controller is one line. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerBrowse, registerOrganise, registerContent, registerSync, registerUpload, registerDownload]) {
    register(server, deps);
  }
};
