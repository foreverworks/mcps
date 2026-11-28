import type { McpServer } from "@foreverworks/mcp-kit";
import type { Deps } from "../app/ports.js";
import { registerAuthorization } from "./controllers/authorization.js";
import { registerBuild } from "./controllers/build.js";
import { registerCompanies } from "./controllers/companies.js";
import { registerDocuments } from "./controllers/documents.js";
import { registerEtransport } from "./controllers/etransport.js";
import { registerHealth, registerTokens } from "./controllers/health.js";
import { registerInvoices } from "./controllers/invoices.js";
import { registerUploads } from "./controllers/uploads.js";
import { type Toolset, TOOLSET_NAMES } from "./toolsets.js";

/**
 * The tool surface of the loaded toolsets (ANAF_EFACTURA_TOOLSETS; every one by
 * default), in one list per toolset. A toolset not loaded registers nothing, so
 * its tools are absent from tools/list rather than listed and failing. Adding a
 * controller is one line in the toolset it belongs to (mcp/toolsets.ts).
 */
export const registerAll = (server: McpServer, deps: Deps, loaded: readonly Toolset[] = TOOLSET_NAMES): void => {
  const controllers = {
    registry: [registerCompanies],
    documents: [registerDocuments, registerBuild],
    invoices: [registerInvoices, registerUploads],
    etransport: [registerEtransport],
    authorization: [registerTokens, registerAuthorization],
  } as const satisfies Record<Toolset, readonly unknown[]>;
  for (const register of [registerHealth, ...TOOLSET_NAMES.filter((toolset) => loaded.includes(toolset)).flatMap((toolset) => controllers[toolset])]) {
    register(server, deps);
  }
};
