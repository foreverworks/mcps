
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Registry } from "../composition.js";
import { registerAttachments } from "./controllers/attachments.js";
import { registerDrafts } from "./controllers/drafts.js";
import { registerFilters } from "./controllers/filters.js";
import { registerHistory } from "./controllers/history.js";
import { registerLabels } from "./controllers/labels.js";
import { registerOrganize } from "./controllers/organize.js";
import { registerSend } from "./controllers/send.js";
import { registerSenders } from "./controllers/senders.js";
import { registerThreads } from "./controllers/threads.js";

/** Gmail's tools, in one list. Adding a controller is one line. list_accounts and health are the server's (src/mcp/accounts.ts). */
export const registerAll = (server: McpServer, registry: Registry): void => {
  for (const register of [
    registerThreads,
    registerHistory,
    registerAttachments,
    registerLabels,
    registerDrafts,
    registerSend,
    registerOrganize,
    registerSenders,
    registerFilters,
  ]) {
    register(server, registry);
  }
};
