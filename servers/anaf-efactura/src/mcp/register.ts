
import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerAuthorization } from "./controllers/authorization.js";
import { registerBuild } from "./controllers/build.js";
import { registerCompanies } from "./controllers/companies.js";
import { registerDocuments } from "./controllers/documents.js";
import { registerEtransport } from "./controllers/etransport.js";
import { registerHealth } from "./controllers/health.js";
import { registerInvoices } from "./controllers/invoices.js";
import { registerUploads } from "./controllers/uploads.js";

/** The whole tool surface, in one list. Adding a controller is one line. */
export const registerAll = (server: McpServer, deps: Deps): void => {
  for (const register of [
    registerHealth,
    registerAuthorization,
    registerInvoices,
    registerUploads,
    registerDocuments,
    registerBuild,
    registerEtransport,
    registerCompanies,
  ]) {
    register(server, deps);
  }
};
