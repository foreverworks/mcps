
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerBuilds } from "./controllers/builds.js";
import { registerCredentials } from "./controllers/credentials.js";
import { registerProjects } from "./controllers/projects.js";
import { registerSubmissions } from "./controllers/submissions.js";
import { registerUpdates } from "./controllers/updates.js";
import { registerWorkflows } from "./controllers/workflows.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [registerProjects, registerBuilds, registerWorkflows, registerSubmissions, registerCredentials, registerUpdates]) {
    register(server, deps);
  }
};
