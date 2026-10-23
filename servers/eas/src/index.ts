#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { asAppError, remedyFor } from "./domain/errors.js";
import { policyFor } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "Expo Application Services for the projects this token sees: builds, workflow runs with each job's log and why a run " +
  "failed, App Store and Play submissions with Apple's or Google's error text, a credentials audit per bundle id and package, " +
  "fingerprints and EAS Update channels. Start with list_workflow_runs or list_builds; a failed run carries its reason, and " +
  "wait_for_run waits for one still going to end. validate_workflow checks an edited workflow file before it is dispatched. " +
  "audit_credentials before blaming a submit job. dispatch_workflow spends EAS build credits: it is the one money tool, and the client asks the user to approve each call.";

/**
 * MCP server for Expo Application Services, on EAS's GraphQL API with an
 * access token. stdio by default, HTTP when MCP_HTTP_PORT is set; `serve` in
 * mcp-kit decides. Nothing is written to stdout: over stdio it IS the protocol.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({
    name: "eas",
    version: packageVersion(import.meta.url),
    ...packageIdentity(import.meta.url),
    instructions: INSTRUCTIONS,
    policy: policyFor(deps),
    // A dispatch's resolve can fail in this server's words (no such workflow, not a ref) before its tool runs.
    vocabulary: { asAppError, remedyFor },
    register: (server) => registerAll(server, deps),
  });
};

main().catch((error: unknown) => {
  console.error("eas failed to start:", error);
  process.exit(1);
});
