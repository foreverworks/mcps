
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerAccounts } from "./controllers/accounts.js";
import { registerBlocks } from "./controllers/blocks.js";
import { registerComments } from "./controllers/comments.js";
import { registerContent } from "./controllers/content.js";
import { registerDatabases } from "./controllers/databases.js";
import { registerFiles } from "./controllers/files.js";
import { registerPages } from "./controllers/pages.js";
import { registerSchema } from "./controllers/schema.js";
import { registerViews } from "./controllers/views.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerAccounts, registerPages, registerBlocks, registerContent, registerDatabases, registerSchema, registerViews, registerFiles, registerComments]) {
    register(server, deps);
  }
};
