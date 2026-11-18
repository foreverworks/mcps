#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { vocabularyFor } from "./mcp/envelope.js";
import { policy } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "eSănătateaMea, CNAS's patient portal, for one person's account: insurance status and package, prescriptions, the services CNAS paid for, " +
  "medical documents (with their PDFs), the emergency summary and appointments. Read-only. Start with health, or with get_insurance. " +
  "With a password configured the server signs in by itself. When a tool answers needs_login, call begin_login; when it answers needs_code, " +
  "ask the user for the six digits of their authenticator app and pass them to complete_login as otp. ROeID (method roeid) needs the user's browser and phone.";

/**
 * MCP server for eSănătateaMea, CNAS's patient portal, on the portal's own
 * APIs with the person's Keycloak session. stdio by default, HTTP when
 * MCP_HTTP_PORT is set; `serve` in mcp-kit decides. Nothing is written to
 * stdout: over stdio it IS the protocol.
 */
const main = async (): Promise<void> => {
  const { deps } = buildDeps();
  await serve({
    name: "esanatateamea",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy,
    vocabulary: vocabularyFor(deps.loginScript),
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("esanatateamea failed to start:", error);
  process.exit(1);
});
