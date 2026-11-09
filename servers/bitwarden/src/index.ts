#!/usr/bin/env node
import { packageIdentity, packageVersion, serve } from "@foreverworks/mcp-kit";

import { buildDeps } from "./composition.js";
import { POLICY } from "./mcp/policy.js";
import { registerAll } from "./mcp/register.js";

const INSTRUCTIONS =
  "A Bitwarden vault where an agent keeps its own logins, 2FA keys, secrets and passkeys. Before signing up anywhere, create_login " +
  "generates and stores the password, and get_password hands it out to type. A site's 2FA key goes in with update_login and its " +
  "codes come out with totp; a secret that is not a login goes in with create_note, from its file, and out with get_field. Never " +
  "copy a password or 2FA key into files, commits, messages or replies.";

/**
 * MCP server for a Bitwarden account an agent keeps its own logins in,
 * through the official CLI (`@bitwarden/cli`, pinned). stdio by default, HTTP
 * when MCP_HTTP_PORT is set. Nothing is written to stdout: over stdio it IS
 * the protocol channel.
 */
const main = async (): Promise<void> => {
  const deps = buildDeps();
  await serve({ name: "bitwarden", version: packageVersion(import.meta.url), ...packageIdentity(import.meta.url), instructions: INSTRUCTIONS, policy: POLICY, register: (server) => registerAll(server, deps) });
};

main().catch((error: unknown) => {
  console.error("bitwarden failed to start:", error);
  process.exit(1);
});
