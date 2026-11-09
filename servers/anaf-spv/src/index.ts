#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { vocabulary } from "./mcp/envelope.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "ANAF's Spațiul Privat Virtual (SPV) for one taxpayer account: the documents ANAF posts there, requests for new ones, and " +
  "declarations. The server signs in by itself. Start with health. list_messages, then download_message or sync_messages; " +
  "request_document, then await_reply; validate_declaration before submit_declaration, the one money tool, which files it. Only " +
  "when a tool answers needs_login: pass the code in the newest \"Cod de siguranta\" e-mail to complete_login.";

/**
 * MCP server for ANAF's SPV, on its own pages with a session it signs in to
 * itself. stdio by default, HTTP when MCP_HTTP_PORT is set; `serve` in
 * mcp-kit decides. Nothing is written to stdout: over stdio it IS the protocol.
 */
const main = async (): Promise<void> => {
  const { deps } = buildDeps();
  await serve({
    name: "anaf-spv",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: policyFor(deps),
    vocabulary,
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("anaf-spv failed to start:", error);
  process.exit(1);
});
