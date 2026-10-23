
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerComments } from "./controllers/comments.js";
import { registerRevisions } from "./controllers/revisions.js";
import { registerSharing } from "./controllers/sharing.js";

/** Comments, sharing and revisions on any Drive file, as an editors account. */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [registerComments, registerSharing, registerRevisions]) register(server, registry);
};
